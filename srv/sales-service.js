const cds = require('@sap/cds');
const { randomUUID } = require('crypto');
const {
    evaluateApprovalPolicy
} = require('./lib/approval-policy');

const { SELECT, INSERT, UPDATE } = cds.ql;

const STATUS = Object.freeze({
    NEW: 'NEW',
    PENDING_APPROVAL: 'PENDING_APPROVAL',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED'
});

function getCorrelationId(req) {
    const suppliedId = req.headers?.['x-correlation-id'];

    if (
        typeof suppliedId === 'string' &&
        suppliedId.trim()
    ) {
        return suppliedId.trim().substring(0, 100);
    }

    return randomUUID();
}

module.exports = cds.service.impl(function () {

    const {
        SalesOrders,
        ApprovalRequests,
        AuditLogs,
        ErrorLogs
    } = cds.entities('salesapproval');

    /*
     * Evaluate whether a sales order requires approval.
     *
     * CAP evaluates the business rules.
     * Integration Suite owns routing and RabbitMQ publishing.
     */
    this.on('EvaluateApproval', async (req) => {

        const orderId = req.data.orderId?.trim();

        if (!orderId) {
            return req.reject(400, 'orderId is required');
        }

        const tx = cds.tx(req);

        const order = await tx.run(
            SELECT.one
                .from(SalesOrders)
                .where({ ID: orderId })
        );

        if (!order) {
            return req.reject(
                404,
                `Sales Order ${orderId} not found`
            );
        }

        let policy;

        try {
            policy = evaluateApprovalPolicy(order);
        } catch (error) {
            return req.reject(
                422,
                `Sales Order ${orderId} contains invalid monetary values`
            );
        }

        return {
            approvalRequired: policy.approvalRequired,
            eventId: randomUUID(),
            correlationId: getCorrelationId(req),
            approvalPath: policy.approvalPath,
            reason: policy.reason
        };
    });

    /*
     * Record an error reported by Integration Suite.
     */
    this.on('LogError', async (req) => {

        const {
            integrationFlow,
            orderId,
            eventId,
            correlationId,
            component,
            errorCode,
            errorMessage,
            failedStep,
            status,
            retryable,
            retryCount
        } = req.data;

        if (
            typeof errorMessage !== 'string' ||
            !errorMessage.trim()
        ) {
            return req.reject(
                400,
                'errorMessage is required'
            );
        }

        const errorLogId = randomUUID();
        const tx = cds.tx(req);

        await tx.run(
            INSERT.into(ErrorLogs).entries({
                ID: errorLogId,
                integrationFlow:
                    integrationFlow || 'UNKNOWN',
                orderId: orderId || null,
                eventId: eventId || null,
                correlationId:
                    correlationId || getCorrelationId(req),
                component:
                    component || 'SAP_INTEGRATION_SUITE',
                errorCode: errorCode || null,
                errorMessage: errorMessage.trim(),
                failedStep: failedStep || null,
                status: status || 'FAILED',
                retryable: Boolean(retryable),
                retryCount:
                    Number.isInteger(retryCount)
                        ? retryCount
                        : 0,
                resolved: false,
                createdAt: new Date().toISOString()
            })
        );

        return {
            success: true,
            errorLogId
        };
    });

    /*
     * Approve a pending request.
     *
     * The conditional update prevents two concurrent decisions
     * from processing the same request.
     */
    this.on('ApproveRequest', async (req) => {

        const eventId = req.data.eventId?.trim();

        if (!eventId) {
            return req.reject(400, 'eventId is required');
        }

        const tx = cds.tx(req);

        const approval = await tx.run(
            SELECT.one
                .from(ApprovalRequests)
                .where({ eventId })
        );

        if (!approval) {
            return req.reject(
                404,
                `Approval request for event ${eventId} not found`
            );
        }

        const affectedRows = await tx.run(
            UPDATE(ApprovalRequests)
                .set({
                    status: STATUS.APPROVED,
                    rejectionReason: null
                })
                .where({
                    eventId,
                    status: STATUS.PENDING_APPROVAL
                })
        );

        if (affectedRows !== 1) {
            return req.reject(
                409,
                `Approval request is already ${approval.status}`
            );
        }

        await tx.run(
            UPDATE(SalesOrders)
                .set({ status: STATUS.APPROVED })
                .where({ ID: approval.orderId })
        );

        await tx.run(
            INSERT.into(AuditLogs).entries({
                ID: randomUUID(),
                orderId: approval.orderId,
                eventId,
                correlationId:
                    approval.correlationId || null,
                eventType: 'SALES_ORDER_APPROVED',
                status: STATUS.APPROVED,
                actor: req.user?.id || 'SYSTEM',
                details: JSON.stringify({
                    previousStatus: approval.status,
                    newStatus: STATUS.APPROVED
                }),
                createdAt: new Date().toISOString()
            })
        );

        return {
            eventId,
            correlationId:
                approval.correlationId || null,
            status: STATUS.APPROVED,
            message:
                `Sales order ${approval.orderId} approved successfully`
        };
    });

    /*
     * Reject a pending request.
     */
    this.on('RejectRequest', async (req) => {

        const eventId = req.data.eventId?.trim();
        const reason = req.data.reason?.trim();

        if (!eventId) {
            return req.reject(400, 'eventId is required');
        }

        if (!reason) {
            return req.reject(
                400,
                'Rejection reason is required'
            );
        }

        const tx = cds.tx(req);

        const approval = await tx.run(
            SELECT.one
                .from(ApprovalRequests)
                .where({ eventId })
        );

        if (!approval) {
            return req.reject(
                404,
                `Approval request for event ${eventId} not found`
            );
        }

        const affectedRows = await tx.run(
            UPDATE(ApprovalRequests)
                .set({
                    status: STATUS.REJECTED,
                    rejectionReason: reason
                })
                .where({
                    eventId,
                    status: STATUS.PENDING_APPROVAL
                })
        );

        if (affectedRows !== 1) {
            return req.reject(
                409,
                `Approval request is already ${approval.status}`
            );
        }

        await tx.run(
            UPDATE(SalesOrders)
                .set({ status: STATUS.REJECTED })
                .where({ ID: approval.orderId })
        );

        await tx.run(
            INSERT.into(AuditLogs).entries({
                ID: randomUUID(),
                orderId: approval.orderId,
                eventId,
                correlationId:
                    approval.correlationId || null,
                eventType: 'SALES_ORDER_REJECTED',
                status: STATUS.REJECTED,
                actor: req.user?.id || 'SYSTEM',
                details: JSON.stringify({
                    previousStatus: approval.status,
                    newStatus: STATUS.REJECTED,
                    rejectionReason: reason
                }),
                createdAt: new Date().toISOString()
            })
        );

        return {
            eventId,
            correlationId:
                approval.correlationId || null,
            status: STATUS.REJECTED,
            message:
                `Sales order ${approval.orderId} rejected successfully`
        };
    });
});
