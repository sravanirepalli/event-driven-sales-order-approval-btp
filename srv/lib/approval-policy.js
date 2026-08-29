'use strict';

const PATHS = Object.freeze({
    NONE: 'NONE',
    SALES_MANAGER: 'SALES_MANAGER',
    SALES_MANAGER_FINANCE: 'SALES_MANAGER -> FINANCE',
    FULL_APPROVAL:
        'SALES_MANAGER -> FINANCE -> BUSINESS_HEAD'
});

function evaluateApprovalPolicy(order) {
    const orderValue = Number(order?.orderValue);
    const discount = Number(order?.discount || 0);

    if (!Number.isFinite(orderValue) || !Number.isFinite(discount)) {
        throw new TypeError('Invalid monetary values');
    }

    if (orderValue >= 100000 && order.customerRisk === 'HIGH') {
        return {
            approvalRequired: true,
            approvalPath: PATHS.FULL_APPROVAL,
            reason: 'HIGH_VALUE_HIGH_RISK'
        };
    }

    if (discount >= 20) {
        return {
            approvalRequired: true,
            approvalPath: PATHS.SALES_MANAGER_FINANCE,
            reason: 'HIGH_DISCOUNT'
        };
    }

    if (orderValue >= 100000) {
        return {
            approvalRequired: true,
            approvalPath: PATHS.SALES_MANAGER,
            reason: 'HIGH_VALUE'
        };
    }

    return {
        approvalRequired: false,
        approvalPath: PATHS.NONE,
        reason: 'STANDARD_ORDER'
    };
}

module.exports = { evaluateApprovalPolicy };
