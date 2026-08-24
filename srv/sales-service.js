const cds = require('@sap/cds');
const { randomUUID } = require('crypto');
const { publishApprovalEvent } = require('./messaging/rabbitmq');

module.exports = cds.service.impl(function () {

    const {
        SalesOrders,
        ApprovalRequests,
        AuditLogs
    } = this.entities;


    this.on('EvaluateApproval', async (req) => {

        const { orderId } = req.data;

        const order = await SELECT.one
            .from(SalesOrders)
            .where({ ID: orderId });

        if (!order) {
            return req.error(
                404,
                `Sales Order ${orderId} not found`
            );
        }

        let approvalRequired = false;
        let approvalPath = 'NONE';
        let reason = 'STANDARD_ORDER';

        if (
            order.orderValue >= 100000 &&
            order.customerRisk === 'HIGH'
        ) {
            approvalRequired = true;
            approvalPath =
                'SALES_MANAGER -> FINANCE -> BUSINESS_HEAD';
            reason = 'HIGH_VALUE_HIGH_RISK';

        } else if (order.discount >= 20) {

            approvalRequired = true;
            approvalPath =
                'SALES_MANAGER -> FINANCE';
            reason = 'HIGH_DISCOUNT';

        } else if (order.orderValue >= 100000) {

            approvalRequired = true;
            approvalPath =
                'SALES_MANAGER';
            reason = 'HIGH_VALUE';
        }


        // Publish approval event to RabbitMQ only
        // when approval is required
        if (approvalRequired) {

            await publishApprovalEvent({
                orderId: order.ID,
                customer: order.customer,
                orderValue: order.orderValue,
                customerRisk: order.customerRisk,
                approvalPath,
                reason
            });
        }


        return {
            approvalRequired,
            approvalPath,
            reason
        };
    });



    this.on('ApproveRequest', async (req) => {

        const { eventId } = req.data;

        const approval = await SELECT.one
            .from(ApprovalRequests)
            .where({ eventId });

        if (!approval) {
            return req.error(
                404,
                `Approval request for event ${eventId} not found`
            );
        }

        if (approval.status !== 'PENDING_APPROVAL') {
            return req.error(
                409,
                `Approval request is already ${approval.status}`
            );
        }


        const tx = cds.tx(req);

        const now = new Date().toISOString();


        // Update approval status
        await tx.run(
            UPDATE(ApprovalRequests)
                .set({
                    status: 'APPROVED',
                    updatedAt: now
                })
                .where({
                    eventId
                })
        );


        // Write approval audit record
        await tx.run(
            INSERT.into(AuditLogs).entries({

                ID: randomUUID(),

                orderId: approval.orderId,

                eventId,

                eventType: 'SALES_ORDER_APPROVED',

                status: 'APPROVED',

                details: JSON.stringify({
                    eventId,
                    orderId: approval.orderId,
                    previousStatus: approval.status,
                    newStatus: 'APPROVED'
                }),

                createdAt: now
            })
        );


        return {
            eventId,
            status: 'APPROVED',
            message:
                `Sales order ${approval.orderId} approved successfully`
        };
    });



    this.on('RejectRequest', async (req) => {

        const {
            eventId,
            reason
        } = req.data;


        const approval = await SELECT.one
            .from(ApprovalRequests)
            .where({ eventId });


        if (!approval) {
            return req.error(
                404,
                `Approval request for event ${eventId} not found`
            );
        }


        if (approval.status !== 'PENDING_APPROVAL') {
            return req.error(
                409,
                `Approval request is already ${approval.status}`
            );
        }


        if (!reason || !reason.trim()) {
            return req.error(
                400,
                'Rejection reason is required'
            );
        }


        const tx = cds.tx(req);

        const now = new Date().toISOString();


        // Update approval status
        await tx.run(
            UPDATE(ApprovalRequests)
                .set({
                    status: 'REJECTED',
                    updatedAt: now
                })
                .where({
                    eventId
                })
        );


        // Write rejection audit record
        await tx.run(
            INSERT.into(AuditLogs).entries({

                ID: randomUUID(),

                orderId: approval.orderId,

                eventId,

                eventType: 'SALES_ORDER_REJECTED',

                status: 'REJECTED',

                details: JSON.stringify({
                    eventId,
                    orderId: approval.orderId,
                    previousStatus: approval.status,
                    newStatus: 'REJECTED',
                    rejectionReason: reason
                }),

                createdAt: now
            })
        );


        return {
            eventId,
            status: 'REJECTED',
            message:
                `Sales order ${approval.orderId} rejected successfully`
        };
    });

});