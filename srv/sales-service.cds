using { salesapproval as db } from '../db/schema';

@requires: 'authenticated-user'
service SalesService {

    @restrict: [
        {
            grant: 'READ',
            to: [
                'IntegrationClient',
                'ApprovalProcessor',
                'Auditor',
                'Administrator'
            ]
        },
        {
            grant: [
                'CREATE',
                'UPDATE'
            ],
            to: [
                'IntegrationClient',
                'Administrator'
            ]
        }
    ]
    entity SalesOrders as projection on db.SalesOrders;

    @readonly
    @restrict: [{
        grant: 'READ',
        to: [
            'ApprovalProcessor',
            'Auditor',
            'Administrator'
        ]
    }]
    entity ApprovalRequests as projection on db.ApprovalRequests;

    @readonly
    @restrict: [{
        grant: 'READ',
        to: [
            'Auditor',
            'Administrator'
        ]
    }]
    entity ProcessedEvents as projection on db.ProcessedEvents;

    @readonly
    @restrict: [{
        grant: 'READ',
        to: [
            'Auditor',
            'Administrator'
        ]
    }]
    entity AuditLogs as projection on db.AuditLogs;

    @readonly
    @restrict: [{
        grant: 'READ',
        to: [
            'Auditor',
            'Administrator'
        ]
    }]
    entity ErrorLogs as projection on db.ErrorLogs;

    event ApprovalRequired {
        eventId        : String(100);
        correlationId  : String(100);
        eventType      : String(100);
        eventVersion   : String(20);
        occurredAt     : Timestamp;
        source         : String(100);
        orderId        : String(20);
        customer       : String(100);
        orderValue     : Decimal(15,2);
        currency       : String(3);
        discount       : Decimal(5,2);
        customerRisk   : String(20);
        approvalPath   : String(255);
        reason         : LargeString;
    }

    @requires: [
        'IntegrationClient',
        'Administrator'
    ]
    action EvaluateApproval(
        orderId : String(20)
    ) returns {
        approvalRequired : Boolean;
        eventId           : String(100);
        correlationId     : String(100);
        approvalPath      : String(255);
        reason            : LargeString;
    };

    @requires: [
        'IntegrationClient',
        'Administrator'
    ]
    action LogError(
        integrationFlow : String(100),
        orderId         : String(20),
        eventId         : String(100),
        correlationId   : String(100),
        component       : String(100),
        errorCode       : String(100),
        errorMessage    : LargeString,
        failedStep      : String(255),
        status          : String(30),
        retryable       : Boolean,
        retryCount      : Integer
    ) returns {
        success    : Boolean;
        errorLogId : UUID;
    };

    @requires: [
        'ApprovalProcessor',
        'Administrator'
    ]
    action ApproveRequest(
        eventId : String(100)
    ) returns {
        eventId       : String(100);
        correlationId : String(100);
        status        : String(30);
        message       : String(200);
    };

    @requires: [
        'ApprovalProcessor',
        'Administrator'
    ]
    action RejectRequest(
        eventId : String(100),
        reason  : LargeString
    ) returns {
        eventId       : String(100);
        correlationId : String(100);
        status        : String(30);
        message       : String(200);
    };
}