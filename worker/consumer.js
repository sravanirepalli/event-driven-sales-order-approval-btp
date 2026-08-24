require('dotenv').config({ path: '../.env' });

const amqp = require('amqplib');
const cds = require('@sap/cds');
const { randomUUID } = require('crypto');

const QUEUE = 'sales-order-approval.queue';

function getRabbitMqUrl() {

    // Local BAS execution
    if (process.env.RABBITMQ_URL) {
        return process.env.RABBITMQ_URL;
    }

    // Cloud Foundry service binding
    if (process.env.VCAP_SERVICES) {

        const vcap = JSON.parse(process.env.VCAP_SERVICES);

        for (const services of Object.values(vcap)) {
            for (const service of services) {

                if (
                    service.name === 'sales-order-approval-rabbitmq' &&
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

async function startConsumer() {

    // Load worker CDS model
    await cds.load('db/schema.cds');

    // Connect to bound HANA HDI container
    const db = await cds.connect.to('db');

    console.log('Connected to HANA database');

    // Use fully-qualified CDS entity names.
    // This avoids the cds.entities(...) compatibility issue.
    const ApprovalRequests = 'salesapproval.ApprovalRequests';
    const ProcessedEvents = 'salesapproval.ProcessedEvents';
    const AuditLogs = 'salesapproval.AuditLogs';

    // RabbitMQ connection
    const rabbitMqUrl = getRabbitMqUrl();

    const connection = await amqp.connect(rabbitMqUrl);
    const channel = await connection.createChannel();

    await channel.assertQueue(QUEUE, {
        durable: true,
        arguments: {
            'x-dead-letter-exchange': 'sales-order-approval.dlx',
            'x-dead-letter-routing-key': 'sales-order-approval.failed'
        }
    });

    // Process one unacknowledged message at a time
    channel.prefetch(1);

    console.log(`Waiting for messages on ${QUEUE}...`);

    channel.consume(
        QUEUE,

        async (msg) => {

            if (!msg) {
                return;
            }

            let event;

            try {

                event = JSON.parse(msg.content.toString());

                console.log(
                    `Approval event received: ${event.eventId}`
                );

                // Basic event validation
                if (!event.eventId || !event.orderId) {
                    throw new Error(
                        'Invalid event: eventId and orderId are required'
                    );
                }

                /*
                 * IDEMPOTENCY CHECK
                 *
                 * RabbitMQ may redeliver a message.
                 * Do not create the same approval twice.
                 */

                const alreadyProcessed = await db.run(
                    SELECT.one
                        .from(ProcessedEvents)
                        .where({
                            eventId: event.eventId
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
                 * ApprovalRequest
                 * AuditLog
                 * ProcessedEvent
                 *
                 * must succeed together.
                 */

                await db.tx(async (tx) => {

                    const now = new Date().toISOString();

                    // 1. Create approval request
                    await tx.run(
                        INSERT.into(ApprovalRequests).entries({

                            ID: randomUUID(),

                            orderId: event.orderId,

                            eventId: event.eventId,

                            approvalPath:
                                event.approvalPath || 'NONE',

                            reason:
                                event.reason || 'UNKNOWN',

                            status:
                                event.status || 'PENDING_APPROVAL',

                            source:
                                event.source || 'RabbitMQ',

                            createdAt: now,

                            updatedAt: now
                        })
                    );

                    // 2. Create audit record
                    await tx.run(
                        INSERT.into(AuditLogs).entries({

                            ID: randomUUID(),

                            orderId: event.orderId,

                            eventId: event.eventId,

                            eventType:
                                event.eventType ||
                                'SALES_ORDER_APPROVAL_REQUIRED',

                            status: 'RECEIVED',

                            details: JSON.stringify(event),

                            createdAt: now
                        })
                    );

                    // 3. Mark event as processed
                    await tx.run(
                        INSERT.into(ProcessedEvents).entries({

                            eventId: event.eventId,

                            orderId: event.orderId,

                            processedAt: now
                        })
                    );
                });

                /*
                 * ACK only after successful HANA commit
                 */
                channel.ack(msg);

                console.log(
                    `Event processed successfully: ${event.eventId}`
                );

            } catch (error) {

                console.error(
                    `Event processing failed: ${event?.eventId || 'UNKNOWN'}`,
                    error
                );

                /*
                 * Reject failed processing.
                 * RabbitMQ will send it through the configured DLX/DLQ path.
                 */
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

startConsumer().catch((error) => {

    console.error(
        'Worker failed to start:',
        error
    );

    process.exit(1);
});