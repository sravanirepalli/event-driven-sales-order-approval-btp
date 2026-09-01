# Postman API Validation

This directory contains the Postman assets used to validate the Event-Driven Sales Order Approval solution across SAP Integration Suite, CAP, RabbitMQ, and SAP Build Process Automation.

## Files

| File | Purpose |
| --- | --- |
| `Sales_Order_Approval.postman_collection.json` | End-to-end API collection with OAuth token handling and automated response checks |
| `Sales_Order_Approval.postman_environment.example.json` | Safe environment template containing no credentials or account-specific URLs |

## Import

1. Import both JSON files into Postman.
2. Duplicate the imported environment and give the copy an environment-specific name.
3. Select that environment before running requests.
4. Populate the required URL and client-credential variables in the private copy only.

Do not commit an environment file containing credentials, tokens, or account-specific values.

## Environment variables

| Variable | Purpose | Sensitive |
| --- | --- | --- |
| `xsuaa_token_url` | OAuth token service base URL for CAP | No |
| `xsuaa_client_id` | OAuth client ID for CAP | Yes |
| `xsuaa_client_secret` | OAuth client secret for CAP | Yes |
| `cpi_token_url` | OAuth token service base URL for Integration Suite | No |
| `cpi_client_id` | OAuth client ID for Integration Suite | Yes |
| `cpi_client_secret` | OAuth client secret for Integration Suite | Yes |
| `cap_base_url` | Deployed CAP application base URL | No |
| `iflow_base_url` | Integration Suite runtime base URL | No |
| `access_token` | CAP access token populated by the collection | Yes |
| `cpi_access_token` | Integration Suite access token populated by the collection | Yes |
| `order_id` | Sales order used for validation | No |
| `approval_event_id` | Approval event used by decision requests | No |
| `rejection_reason` | Sample rejection explanation | No |

Enter base URLs without a trailing slash.

## Request sequence

1. **01 - Get XSUAA Token** obtains and stores `access_token`.
2. **01B - Get Integration Suite Token** obtains and stores `cpi_access_token`.
3. **02 - Evaluate Approval** validates the CAP approval policy and stores the returned event ID.
4. **03 - Approve Request** validates the CAP approval callback.
5. **04 - Reject Request** validates the rejection callback and reason handling.
6. **05 - Trigger Approval iFlow** starts the complete Integration Suite approval process.

The approval and rejection requests represent alternative outcomes. Run only the decision appropriate for the event being tested.

## Automated checks

The collection validates:

- Expected HTTP response codes
- OAuth token responses
- Approval-decision response structure
- Response time below ten seconds
- Automatic storage of tokens and approval event identifiers

## Security

- Keep all client secrets and generated tokens in a private Postman environment.
- Never commit exported environments containing populated values.
- Never place bearer tokens directly in request headers or request definitions.
- Rotate credentials immediately if they are exposed in source control, logs, or screenshots.

