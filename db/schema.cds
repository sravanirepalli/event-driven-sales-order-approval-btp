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