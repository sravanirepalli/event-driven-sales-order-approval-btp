'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    evaluateApprovalPolicy
} = require('../srv/lib/approval-policy');

test('routes high-value, high-risk orders through all approvers', () => {
    assert.deepEqual(evaluateApprovalPolicy({
        orderValue: 200000,
        discount: 22,
        customerRisk: 'HIGH'
    }), {
        approvalRequired: true,
        approvalPath: 'SALES_MANAGER -> FINANCE -> BUSINESS_HEAD',
        reason: 'HIGH_VALUE_HIGH_RISK'
    });
});

test('routes high-discount orders through manager and finance', () => {
    assert.deepEqual(evaluateApprovalPolicy({
        orderValue: 50000,
        discount: 20,
        customerRisk: 'LOW'
    }), {
        approvalRequired: true,
        approvalPath: 'SALES_MANAGER -> FINANCE',
        reason: 'HIGH_DISCOUNT'
    });
});

test('routes high-value orders to the sales manager', () => {
    assert.deepEqual(evaluateApprovalPolicy({
        orderValue: 100000,
        discount: 0,
        customerRisk: 'LOW'
    }), {
        approvalRequired: true,
        approvalPath: 'SALES_MANAGER',
        reason: 'HIGH_VALUE'
    });
});

test('allows standard orders to continue without approval', () => {
    assert.deepEqual(evaluateApprovalPolicy({
        orderValue: 99999.99,
        discount: 19.99,
        customerRisk: 'LOW'
    }), {
        approvalRequired: false,
        approvalPath: 'NONE',
        reason: 'STANDARD_ORDER'
    });
});

test('gives the high-risk rule precedence over discount', () => {
    const result = evaluateApprovalPolicy({
        orderValue: 100000,
        discount: 25,
        customerRisk: 'HIGH'
    });

    assert.equal(result.reason, 'HIGH_VALUE_HIGH_RISK');
});

test('rejects invalid monetary values', () => {
    assert.throws(() => evaluateApprovalPolicy({
        orderValue: 'not-a-number',
        discount: 0,
        customerRisk: 'LOW'
    }), /Invalid monetary values/);
});
