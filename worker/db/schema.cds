namespace salesapproval;

using {
    cuid,
    managed
} from '@sap/cds/common';

type SalesOrderStatus : String(30) enum {
    NEW               = 'NEW';
    APPROVAL_REQUIRED = 'APPROVAL_REQUIRED';
    PENDING_APPROVAL  = 'PENDING_APPROVAL';
    APPROVED          = 'APPROVED';
    REJECTED          = 'REJECTED';
    PROCESSING_ERROR  = 'PROCESSING_ERROR';
}

type ApprovalStatus : String(30) enum {
    PENDING_APPROVAL = 'PENDING_APPROVAL';
    APPROVED         = 'APPROVED';
    REJECTED         = 'REJECTED';
    CANCELLED        = 'CANCELLED';
    ERROR            = 'ERROR';
}

type AuditStatus : String(30) enum {
    RECEIVED = 'RECEIVED';
    SUCCESS  = 'SUCCESS';
    APPROVED = 'APPROVED';
    REJECTED = 'REJECTED';
    FAILED   = 'FAILED';
}

entity SalesOrders : managed {
    key ID          : String(20);
        customer    : String(100) not null;
        orderValue  : Decimal(15,2) not null;
        currency    : String(3) default 'USD';
        discount    : Decimal(5,2) default 0;
        customerRisk : String(20);
        commercialTerms : String(100);
        status      : SalesOrderStatus default 'NEW';
}

@assert.unique.eventId: [eventId]
entity ApprovalRequests : cuid, managed {
    orderId            : String(20) not null;
    eventId            : String(100) not null;
    correlationId      : String(100);
    approvalPath       : String(255);
    reason             : LargeString;
    status             : ApprovalStatus default 'PENDING_APPROVAL';
    source             : String(100);
    workflowInstanceId : String(255);
    rejectionReason    : LargeString;

    order : Association to SalesOrders
        on order.ID = orderId;
}

entity ProcessedEvents {
    key eventId      : String(100);
        orderId      : String(20) not null;
        correlationId : String(100);
        eventType    : String(100);
        processedAt  : Timestamp;
}

entity AuditLogs : cuid {
    orderId       : String(20);
    eventId       : String(100);
    correlationId : String(100);
    eventType     : String(100) not null;
    status        : AuditStatus;
    actor         : String(255);
    details       : LargeString;
    createdAt     : Timestamp;
}

entity ErrorLogs : cuid {
    orderId          : String(20);
    eventId          : String(100);
    correlationId    : String(100);
    integrationFlow  : String(100);
    component        : String(100);
    errorCode        : String(100);
    errorMessage     : LargeString not null;
    failedStep       : String(255);
    status           : String(30);
    retryable        : Boolean default false;
    retryCount       : Integer default 0;
    resolved         : Boolean default false;
    createdAt        : Timestamp;
    resolvedAt       : Timestamp;
}