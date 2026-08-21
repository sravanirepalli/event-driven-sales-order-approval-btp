using { salesapproval as db } from '../db/schema';

service SalesService {
    entity SalesOrders as projection on db.SalesOrders;
event ApprovalRequired {
    orderId        : String(20);
    customer       : String(100);
    orderValue     : Decimal(15,2);
    customerRisk   : String(20);
    approvalPath   : String(100);
    reason         : String(100);
}
    action EvaluateApproval(
        orderId : String(20)
    ) returns {
        approvalRequired : Boolean;
        approvalPath     : String(100);
        reason           : String(100);
    };
}
