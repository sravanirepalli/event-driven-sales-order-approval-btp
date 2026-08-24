using { salesapproval as db } from '../db/schema';

service SalesService {

    entity SalesOrders as projection on db.SalesOrders;

    entity ApprovalRequests as projection on db.ApprovalRequests;

    entity ProcessedEvents as projection on db.ProcessedEvents;

    entity AuditLogs as projection on db.AuditLogs;

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

    action ApproveRequest(
        eventId : String(100)
    ) returns {
        eventId : String(100);
        status  : String(30);
        message : String(200);
    };

    action RejectRequest(
        eventId : String(100),
        reason  : String(200)
    ) returns {
        eventId : String(100);
        status  : String(30);
        message : String(200);
    };
}