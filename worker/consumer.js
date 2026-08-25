require('dotenv').config({ path: '../.env' });

const amqp = require('amqplib');
const cds = require('@sap/cds');
const { randomUUID } = require('crypto');

const QUEUE = 'sales-order-approval.queue';

const RETRY_EXCHANGE = 'sales-order-approval.retry-exchange';
const RETRY_QUEUE = 'sales-order-approval.retry';
const RETRY_ROUTING_KEY = 'sales-order-approval.retry';

const DLX = 'sales-order-approval.dlx';
const DLQ = 'sales-order-approval.dlq';
const DLQ_ROUTING_KEY = 'sales-order-approval.failed';

const MAX_RETRIES = 3;


/*
 * FAILURE AUDIT
 *
 * Records permanent processing failures in HANA.
 *
 * If HANA itself is unavailable, this function catches
 * the audit failure so the worker does not crash.
 */
async function writeFailureAudit(
    db,
    AuditLogs,
    event,
    error,
    retryCount,
    failureType
) {
    try {

        const now = new Date().toISOString();

        await db.run(
            INSERT.into(AuditLogs).entries({

                ID: randomUUID(),

                orderId:
                    event?.orderId || 'UNKNOWN',

                eventId:
                    event?.eventId || `UNKNOWN-${Date.now()}`,

                eventType:
                    'SALES_ORDER_PROCESSING_FAILED',

                status:
                    'FAILED',

                details: JSON.stringify({
                    eventId:
                        event?.eventId || null,

                    orderId:
                        event?.orderId || null,

                    failureType,

                    retryCount,

                    error:
                        error?.message || String(error)
                }),

                createdAt:
                    now
            })
        );

        console.log(
            `Failure audit recorded: ${event?.eventId || 'UNKNOWN'}`
        );

    } catch (auditError) {

        console.error(
            `Unable to write failure audit for ${event?.eventId || 'UNKNOWN'}:`,
            auditError.message
        );
    }
}


/*
 * GET RABBITMQ CONNECTION URL
 *
 * Supports:
 * 1. BAS/local execution through .env
 * 2. Cloud Foundry service binding
 */
function getRabbitMqUrl() {

    if (process.env.RABBITMQ_URL) {
        return process.env.RABBITMQ_URL;
    }

    if (process.env.VCAP_SERVICES) {

        const vcap =
            JSON.parse(process.env.VCAP_SERVICES);

        for (const services of Object.values(vcap)) {

            for (const service of services) {

                if (
                    service.name ===
                        'sales-order-approval-rabbitmq' &&
                    service.credentials?.RABBITMQ_URL
                ) {

                    return service.credentials.RABBITMQ_URL;
                }
            }
        }
    }

    throw new Error(
        'RABBITMQ_URL not found in environment or Cloud Foundry service binding'
    );
}


/*
 * START WORKER
 */
async function startConsumer() {

    // Load worker CDS model
    await cds.load('db/schema.cds');

    // Connect to HANA
    const db =
        await cds.connect.to('db');

    console.log(
        'Connected to HANA database'
    );


    /*
     * Fully-qualified CDS entities
     */
    const ApprovalRequests =
        'salesapproval.ApprovalRequests';

    const ProcessedEvents =
        'salesapproval.ProcessedEvents';

    const AuditLogs =
        'salesapproval.AuditLogs';


    /*
     * Connect to RabbitMQ
     */
    const rabbitMqUrl =
        getRabbitMqUrl();

    const connection =
        await amqp.connect(rabbitMqUrl);

    const channel =
        await connection.createChannel();


    /*
     * DEAD-LETTER INFRASTRUCTURE
     */
    await channel.assertExchange(
        DLX,
        'direct',
        {
            durable: true
        }
    );

    await channel.assertQueue(
        DLQ,
        {
            durable: true
        }
    );

    await channel.bindQueue(
        DLQ,
        DLX,
        DLQ_ROUTING_KEY
    );


    /*
     * RETRY INFRASTRUCTURE
     *
     * Messages wait 5 seconds here.
     * RabbitMQ then sends them back
     * to the main queue.
     */
    await channel.assertExchange(
        RETRY_EXCHANGE,
        'direct',
        {
            durable: true
        }
    );

    await channel.assertQueue(
        RETRY_QUEUE,
        {
            durable: true,

            arguments: {

                'x-message-ttl':
                    5000,

                'x-dead-letter-exchange':
                    '',

                'x-dead-letter-routing-key':
                    QUEUE
            }
        }
    );

    await channel.bindQueue(
        RETRY_QUEUE,
        RETRY_EXCHANGE,
        RETRY_ROUTING_KEY
    );


    /*
     * MAIN APPROVAL QUEUE
     */
    await channel.assertQueue(
        QUEUE,
        {
            durable: true,

            arguments: {

                'x-dead-letter-exchange':
                    DLX,

                'x-dead-letter-routing-key':
                    DLQ_ROUTING_KEY
            }
        }
    );


    /*
     * Process one unacknowledged
     * message at a time.
     */
    channel.prefetch(1);

    console.log(
        `Waiting for messages on ${QUEUE}...`
    );


    /*
     * CONSUMER
     */
    channel.consume(

        QUEUE,

        async (msg) => {

            if (!msg) {
                return;
            }

            let event;

            try {

                /*
                 * PARSE EVENT
                 */
                event =
                    JSON.parse(
                        msg.content.toString()
                    );

                console.log(
                    `Approval event received: ${event.eventId}`
                );


                /*
                 * EVENT VALIDATION
                 *
                 * Invalid business messages
                 * should not be retried.
                 */
                if (
                    !event.eventId ||
                    !event.orderId
                ) {

                    const validationError =
                        new Error(
                            'Invalid event: eventId and orderId are required'
                        );

                    validationError.nonRetryable =
                        true;

                    throw validationError;
                }


                /*
                 * IDEMPOTENCY CHECK
                 *
                 * Prevent duplicate approval
                 * records when RabbitMQ
                 * redelivers an event.
                 */
                const alreadyProcessed =
                    await db.run(

                        SELECT.one
                            .from(ProcessedEvents)
                            .where({
                                eventId:
                                    event.eventId
                            })
                    );


                if (alreadyProcessed) {

                    console.log(
                        `Duplicate event skipped: ${event.eventId}`
                    );

                    channel.ack(msg);

                    return;
                }


                /*
                 * DATABASE TRANSACTION
                 *
                 * These three operations must
                 * succeed or fail together.
                 */
                await db.tx(async (tx) => {

                    const now =
                        new Date().toISOString();


                    /*
                     * 1. CREATE APPROVAL REQUEST
                     */
                    await tx.run(

                        INSERT
                            .into(ApprovalRequests)
                            .entries({

                                ID:
                                    randomUUID(),

                                orderId:
                                    event.orderId,

                                eventId:
                                    event.eventId,

                                approvalPath:
                                    event.approvalPath ||
                                    'NONE',

                                reason:
                                    event.reason ||
                                    'UNKNOWN',

                                status:
                                    event.status ||
                                    'PENDING_APPROVAL',

                                source:
                                    event.source ||
                                    'RabbitMQ',

                                createdAt:
                                    now,

                                updatedAt:
                                    now
                            })
                    );


                    /*
                     * 2. CREATE AUDIT RECORD
                     */
                    await tx.run(

                        INSERT
                            .into(AuditLogs)
                            .entries({

                                ID:
                                    randomUUID(),

                                orderId:
                                    event.orderId,

                                eventId:
                                    event.eventId,

                                eventType:
                                    event.eventType ||
                                    'SALES_ORDER_APPROVAL_REQUIRED',

                                status:
                                    'RECEIVED',

                                details:
                                    JSON.stringify(event),

                                createdAt:
                                    now
                            })
                    );


                    /*
                     * 3. MARK EVENT PROCESSED
                     */
                    await tx.run(

                        INSERT
                            .into(ProcessedEvents)
                            .entries({

                                eventId:
                                    event.eventId,

                                orderId:
                                    event.orderId,

                                processedAt:
                                    now
                            })
                    );
                });


                /*
                 * ACK ONLY AFTER
                 * SUCCESSFUL HANA COMMIT
                 */
                channel.ack(msg);

                console.log(
                    `Event processed successfully: ${event.eventId}`
                );


            } catch (error) {

                console.error(
                    `Event processing failed: ${event?.eventId || 'UNKNOWN'}`,
                    error.message
                );


                /*
                 * NON-RETRYABLE FAILURE
                 *
                 * Example:
                 * invalid event payload.
                 *
                 * Audit it and send directly
                 * to the DLQ.
                 */
                if (error.nonRetryable) {

                    console.error(
                        `Non-retryable error. Sending event to DLQ: ${event?.eventId || 'UNKNOWN'}`
                    );

                    await writeFailureAudit(
                        db,
                        AuditLogs,
                        event,
                        error,
                        0,
                        'NON_RETRYABLE'
                    );

                    channel.nack(
                        msg,
                        false,
                        false
                    );

                    return;
                }


                /*
                 * CURRENT RETRY COUNT
                 */
                const headers =
                    msg.properties.headers || {};

                const currentRetryCount =
                    Number(
                        headers['x-retry-count'] || 0
                    );


                /*
                 * RETRY TEMPORARY FAILURE
                 */
                if (
                    currentRetryCount <
                    MAX_RETRIES
                ) {

                    const nextRetryCount =
                        currentRetryCount + 1;

                    console.log(
                        `Retrying event ${event?.eventId || 'UNKNOWN'} - attempt ${nextRetryCount}/${MAX_RETRIES}`
                    );


                    /*
                     * Send a copy to the retry queue.
                     *
                     * The retry count is carried
                     * in the RabbitMQ header.
                     */
                    channel.publish(
                        RETRY_EXCHANGE,
                        RETRY_ROUTING_KEY,
                        msg.content,
                        {
                            persistent:
                                true,

                            contentType:
                                msg.properties.contentType ||
                                'application/json',

                            headers: {
                                ...headers,

                                'x-retry-count':
                                    nextRetryCount
                            }
                        }
                    );


                    /*
                     * Original message can now
                     * be acknowledged because
                     * the retry copy was published.
                     */
                    channel.ack(msg);

                    return;
                }


                /*
                 * RETRIES EXHAUSTED
                 *
                 * Record permanent failure
                 * and send to DLQ.
                 */
                console.error(
                    `Maximum retries reached for event ${event?.eventId || 'UNKNOWN'}. Sending to DLQ.`
                );

                await writeFailureAudit(
                    db,
                    AuditLogs,
                    event,
                    error,
                    currentRetryCount,
                    'RETRIES_EXHAUSTED'
                );

                channel.nack(
                    msg,
                    false,
                    false
                );
            }
        },

        {
            noAck: false
        }
    );
}


/*
 * WORKER STARTUP FAILURE
 */
startConsumer().catch((error) => {

    console.error(
        'Worker failed to start:',
        error
    );

    process.exit(1);
});