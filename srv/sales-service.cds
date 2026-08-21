using { salesapproval as db } from '../db/schema';

service SalesService {
    entity SalesOrders as projection on db.SalesOrders;

    action EvaluateApproval(
        orderId : String(20)
    ) returns {
        approvalRequired : Boolean;
        approvalPath     : String(100);
        reason           : String(100);
    };
}
