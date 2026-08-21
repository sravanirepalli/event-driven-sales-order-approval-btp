const { publishApprovalEvent } = require('../messaging/rabbitmq');
const cds = require('@sap/cds');

module.exports = cds.service.impl(function () {

    const { SalesOrders } = this.entities;

    this.on('EvaluateApproval', async (req) => {
        const { orderId } = req.data;

        const order = await SELECT.one
            .from(SalesOrders)
            .where({ ID: orderId });

        if (!order) {
            return req.error(404, `Sales Order ${orderId} not found`);
        }

        let approvalRequired = false;
        let approvalPath = 'NONE';
        let reason = 'STANDARD_ORDER';

        if (order.orderValue >= 100000 && order.customerRisk === 'HIGH') {
            approvalRequired = true;
            approvalPath = 'SALES_MANAGER -> FINANCE -> BUSINESS_HEAD';
            reason = 'HIGH_VALUE_HIGH_RISK';

        } else if (order.discount >= 20) {
            approvalRequired = true;
            approvalPath = 'SALES_MANAGER -> FINANCE';
            reason = 'HIGH_DISCOUNT';

        } else if (order.orderValue >= 100000) {
            approvalRequired = true;
            approvalPath = 'SALES_MANAGER';
            reason = 'HIGH_VALUE';
        }
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

});