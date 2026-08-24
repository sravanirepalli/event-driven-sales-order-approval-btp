namespace salesapproval;

entity SalesOrders {
    key ID          : String(20);
    customer        : String(50);
    orderValue      : Decimal(15,2);
    discount        : Decimal(5,2);
    customerRisk    : String(20);
    commercialTerms : String(30);
    status          : String(30);
}
entity ApprovalRequests {
    key ID       : UUID;
    orderId      : String(20);
    eventId      : String(100);
    approvalPath : String(100);
    reason       : String(100);
    status       : String(30);
    source       : String(100);
    createdAt    : Timestamp;
    updatedAt    : Timestamp;
}

entity ProcessedEvents {
    key eventId  : String(100);
    orderId      : String(20);
    processedAt  : Timestamp;
}

entity AuditLogs {
    key ID       : UUID;
    orderId      : String(20);
    eventId      : String(100);
    eventType    : String(100);
    status       : String(30);
    details      : LargeString;
    createdAt    : Timestamp;
}