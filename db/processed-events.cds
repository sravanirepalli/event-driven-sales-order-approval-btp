namespace sales.approval;

entity ProcessedEvents {
    key eventId     : String(100);
        orderId     : String(50);
        processedAt : Timestamp;
        status      : String(30);
}