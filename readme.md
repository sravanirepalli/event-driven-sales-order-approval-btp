# Event-Driven Sales Order Approval on SAP BTP

An enterprise approval scenario connecting SAP Integration Suite, CAP/HANA,
RabbitMQ, an asynchronous Node.js worker, and SAP Build Process Automation.

## Worker configuration

The Cloud Foundry worker consumes `sales-order-approval.queue`, creates the
pending approval record in HANA, and starts the deployed SAP Build workflow.

| Variable | Purpose |
| --- | --- |
| `RABBITMQ_URL` | RabbitMQ AMQPS URL when no service binding is used |
| `SAP_BUILD_API_URL` | Full workflow-instances API URL from the API trigger |
| `SAP_BUILD_DEFINITION_ID` | Deployed process definition ID |
| `DEFAULT_APPROVER_EMAIL` | Fallback inbox recipient |

Bind the `sales-order-approval-process-automation` service instance to the
worker so OAuth credentials are supplied securely through `VCAP_SERVICES`.

## CAP development

Welcome to your new CAP project.

It contains these folders and files, following our recommended project layout:

File or Folder | Purpose
---------|----------
`app/` | content for UI frontends goes here
`db/` | your domain models and data go here
`srv/` | your service models and code go here
`readme.md` | this getting started guide

## Next Steps

- Open a new terminal and run `cds watch`
- (in VS Code simply choose _**Terminal** > Run Task > cds watch_)
- Start with your domain model, in a CDS file in `db/`

## Learn More

Learn more at <https://cap.cloud.sap>.
