const path = require('path');

require('dotenv').config({
    path: path.resolve(__dirname, '../.env')
});

const amqp = require('amqplib');
const cds = require('@sap/cds');
const { randomUUID } = require('crypto');

const { SELECT, INSERT, UPDATE } = cds.ql;

const QUEUE = 'sales-order-approval.queue';
const RETRY_EXCHANGE = 'sales-order-approval.retry-exchange';
const RETRY_QUEUE = 'sales-order-approval.retry';
const RETRY_ROUTING_KEY = 'sales-order-approval.retry';
const DLX = 'sales-order-approval.dlx';
const DLQ = 'sales-order-approval.dlq';
const DLQ_ROUTING_KEY = 'sales-order-approval.failed';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

const ENTITIES = Object.freeze({
    SalesOrders: 'salesapproval.SalesOrders',
    ApprovalRequests: 'salesapproval.ApprovalRequests',
    ProcessedEvents: 'salesapproval.ProcessedEvents',
    AuditLogs: 'salesapproval.AuditLogs',
    ErrorLogs: 'salesapproval.ErrorLogs'
});

let connection;
let channel;
let consumerTag;
let shuttingDown = false;
let sapBuildTokenCache;

function requireEnv(name) {
    const value = process.env[name];

    if (!value) {
        throw new Error(`${name} is required`);
    }

    return value;
}

function getSapBuildCredentials() {
    if (
        process.env.SAP_BUILD_CLIENT_ID &&
        process.env.SAP_BUILD_CLIENT_SECRET &&
        process.env.SAP_BUILD_TOKEN_URL
    ) {
        return {
            clientId: process.env.SAP_BUILD_CLIENT_ID,
            clientSecret: process.env.SAP_BUILD_CLIENT_SECRET,
            tokenUrl: process.env.SAP_BUILD_TOKEN_URL
        };
    }

    if (process.env.VCAP_SERVICES) {
        const vcap = JSON.parse(process.env.VCAP_SERVICES);

        for (const services of Object.values(vcap)) {
            for (const service of services) {
                const credentials = service.credentials || {};
                const isSapBuild =
                    service.name === 'sales-order-approval-process-automation' ||
                    service.label === 'process-automation-service' ||
                    service.tags?.includes('process-automation');

                if (
                    isSapBuild &&
                    credentials.clientid &&
                    credentials.clientsecret &&
                    credentials.url
                ) {
                    return {
                        clientId: credentials.clientid,
                        clientSecret: credentials.clientsecret,
                        tokenUrl: `${credentials.url.replace(/\/$/, '')}/oauth/token`
                    };
                }
            }
        }
    }

    throw new Error(
        'SAP Build credentials were not found in the environment or service binding'
    );
}

async function getSapBuildAccessToken() {
    const now = Date.now();

    if (sapBuildTokenCache?.expiresAt > now + 30000) {
        return sapBuildTokenCache.accessToken;
    }

    const { tokenUrl, clientId, clientSecret } =
        getSapBuildCredentials();
    const basicAuth = Buffer.from(
        `${clientId}:${clientSecret}`
    ).toString('base64');

    const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${basicAuth}`,
            'Content-Type':
                'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
    });

    if (!response.ok) {
        throw new Error(
            `SAP Build token request failed with HTTP ${response.status}`
        );
    }

    const token = await response.json();

    sapBuildTokenCache = {
        accessToken: token.access_token,
        expiresAt:
            now +
            Number(token.expires_in || 300) * 1000
    };

    return sapBuildTokenCache.accessToken;
}

function buildApprovalContext(event) {
    return {
        eventId: event.eventId,
        correlationId: event.correlationId,
        orderId: event.orderId,
        customer: event.customer || 'UNKNOWN',
        orderValue: Number(event.orderValue || 0),
        currency: event.currency || 'USD',
        customerRisk: event.customerRisk || 'UNKNOWN',
        approvalPath:
            event.approvalPath || 'SALES_MANAGER',
        reason:
            event.reason || 'APPROVAL_REQUIRED',
        requestedAt:
            event.requestedAt ||
            new Date().toISOString(),
        approverEmail:
            event.approverEmail ||
            requireEnv('DEFAULT_APPROVER_EMAIL')
    };
}

async function startSapBuildWorkflow(event) {
    const accessToken =
        await getSapBuildAccessToken();
    const apiUrl = requireEnv('SAP_BUILD_API_URL');
    const definitionId =
        requireEnv('SAP_BUILD_DEFINITION_ID');

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json'
        },
        body: JSON.stringify({
            definitionId,
            context: {
                approvalContext:
                    buildApprovalContext(event)
            }
        })
    });

    const responseText = await response.text();

    if (!response.ok) {
        throw new Error(
            `SAP Build workflow start failed with HTTP ${response.status}: ${responseText}`
        );
    }

    const workflow = responseText
        ? JSON.parse(responseText)
        : {};

    console.log(
        `Started SAP Build workflow ${workflow.id || 'accepted'} for event=${event.eventId}`
    );

    return workflow;
}

function getRabbitMqUrl() {
    if (process.env.RABBITMQ_URL) {
        return process.env.RABBITMQ_URL;
    }

    if (!process.env.VCAP_SERVICES) {
        throw new Error(
            'RabbitMQ credentials were not found in the environment'
        );
    }

    let vcap;

    try {
        vcap = JSON.parse(process.env.VCAP_SERVICES);
    } catch {
        throw new Error('VCAP_SERVICES contains invalid JSON');
    }

    for (const services of Object.values(vcap)) {
        for (const service of services) {
            const credentials = service.credentials || {};

            const url =
                credentials.RABBITMQ_URL ||
                credentials.uri ||
                credentials.url;

            if (
                service.name ===
                    'sales-order-approval-rabbitmq' &&
                url
            ) {
                return url;
            }
        }
    }

    throw new Error(
        'The sales-order-approval-rabbitmq binding has no supported connection URL'
    );
}

function parseEvent(msg) {
    let event;

    try {
        event = JSON.parse(msg.content.toString('utf8'));
    } catch {
        const error = new Error(
            'Message body is not valid JSON'
        );

        error.nonRetryable = true;
        throw error;
    }

    if (
        !event ||
        typeof event.eventId !== 'string' ||
        !event.eventId.trim() ||
        typeof event.orderId !== 'string' ||
        !event.orderId.trim() ||
        typeof event.correlationId !== 'string' ||
        !event.correlationId.trim()
    ) {
        const error = new Error(
            'eventId, orderId and correlationId are required'
        );

        error.nonRetryable = true;
        throw error;
    }

    return {
        ...event,
        eventId: event.eventId.trim(),
        orderId: event.orderId.trim(),
        correlationId: event.correlationId.trim()
    };
}

async function writeFailureRecords(
    db,
    event,
    error,
    retryCount,
    failureType
) {
    try {
        const now = new Date().toISOString();
        const eventId =
            event?.eventId || `UNKNOWN-${randomUUID()}`;

        await db.tx(async (tx) => {
            await tx.run(
                INSERT.into(ENTITIES.AuditLogs).entries({
                    ID: randomUUID(),
                    orderId: event?.orderId || null,
                    eventId,
                    correlationId:
                        event?.correlationId || null,
                    eventType:
                        'SALES_ORDER_PROCESSING_FAILED',
                    status: 'FAILED',
                    actor: 'RABBITMQ_WORKER',
                    details: JSON.stringify({
                        failureType,
                        retryCount,
                        error:
                            error?.message ||
                            String(error)
                    }),
                    createdAt: now
                })
            );

            await tx.run(
                INSERT.into(ENTITIES.ErrorLogs).entries({
                    ID: randomUUID(),
                    orderId: event?.orderId || null,
                    eventId,
                    correlationId:
                        event?.correlationId || null,
                    component: 'RABBITMQ_WORKER',
                    errorCode: failureType,
                    errorMessage:
                        error?.message || String(error),
                    failedStep: 'CONSUME_APPROVAL_EVENT',
                    status: 'FAILED',
                    retryable:
                        failureType !== 'NON_RETRYABLE',
                    retryCount,
                    resolved: false,
                    createdAt: now
                })
            );
        });

        console.log(
            `Failure records written for ${eventId}`
        );
    } catch (auditError) {
        console.error(
            'Unable to write failure records:',
            auditError.message
        );
    }
}

async function initializeTopology(ch) {
    await ch.assertExchange(DLX, 'direct', {
        durable: true
    });

    await ch.assertQueue(DLQ, {
        durable: true
    });

    await ch.bindQueue(
        DLQ,
        DLX,
        DLQ_ROUTING_KEY
    );

    await ch.assertExchange(
        RETRY_EXCHANGE,
        'direct',
        { durable: true }
    );

    await ch.assertQueue(RETRY_QUEUE, {
        durable: true,
        arguments: {
            'x-message-ttl': RETRY_DELAY_MS,
            'x-dead-letter-exchange': '',
            'x-dead-letter-routing-key': QUEUE
        }
    });

    await ch.bindQueue(
        RETRY_QUEUE,
        RETRY_EXCHANGE,
        RETRY_ROUTING_KEY
    );

    await ch.assertQueue(QUEUE, {
        durable: true,
        arguments: {
            'x-dead-letter-exchange': DLX,
            'x-dead-letter-routing-key':
                DLQ_ROUTING_KEY
        }
    });

    await ch.prefetch(1);
}

async function processEvent(db, event) {
    const alreadyProcessed = await db.run(
        SELECT.one
            .from(ENTITIES.ProcessedEvents)
            .where({ eventId: event.eventId })
    );

    if (alreadyProcessed) {
        return 'DUPLICATE';
    }

    const existingApproval = await db.run(
        SELECT.one
            .from(ENTITIES.ApprovalRequests)
            .where({ eventId: event.eventId })
    );

    if (!existingApproval) {
        await db.tx(async (tx) => {
            const now = new Date().toISOString();

            await tx.run(
                INSERT.into(ENTITIES.ApprovalRequests)
                    .entries({
                        ID: randomUUID(),
                        orderId: event.orderId,
                        eventId: event.eventId,
                        correlationId:
                            event.correlationId,
                        approvalPath:
                            event.approvalPath || 'NONE',
                        reason:
                            event.reason || 'UNKNOWN',
                        status: 'PENDING_APPROVAL',
                        source:
                            event.source ||
                            'SAP_INTEGRATION_SUITE',
                        workflowInstanceId:
                            event.workflowInstanceId ||
                            null
                    })
            );

            const updatedOrders = await tx.run(
                UPDATE(ENTITIES.SalesOrders)
                    .set({
                        status: 'PENDING_APPROVAL'
                    })
                    .where({ ID: event.orderId })
            );

            if (updatedOrders !== 1) {
                throw new Error(
                    `Sales Order ${event.orderId} was not found`
                );
            }

            await tx.run(
                INSERT.into(ENTITIES.AuditLogs).entries({
                    ID: randomUUID(),
                    orderId: event.orderId,
                    eventId: event.eventId,
                    correlationId:
                        event.correlationId,
                    eventType:
                        event.eventType ||
                        'SALES_ORDER_APPROVAL_REQUIRED',
                    status: 'RECEIVED',
                    actor: 'RABBITMQ_WORKER',
                    details: JSON.stringify(event),
                    createdAt: now
                })
            );
        });
    }

    const workflow =
        await startSapBuildWorkflow(event);

    await db.tx(async (tx) => {
        const now = new Date().toISOString();

        await tx.run(
            UPDATE(ENTITIES.ApprovalRequests)
                .set({
                    workflowInstanceId:
                        workflow.id || null
                })
                .where({ eventId: event.eventId })
        );

        await tx.run(
            INSERT.into(ENTITIES.AuditLogs).entries({
                ID: randomUUID(),
                orderId: event.orderId,
                eventId: event.eventId,
                correlationId:
                    event.correlationId,
                eventType:
                    'SAP_BUILD_WORKFLOW_STARTED',
                status: 'STARTED',
                actor: 'RABBITMQ_WORKER',
                details: JSON.stringify({
                    workflowInstanceId:
                        workflow.id || null,
                    definitionId:
                        process.env.SAP_BUILD_DEFINITION_ID
                }),
                createdAt: now
            })
        );

        await tx.run(
            INSERT.into(ENTITIES.ProcessedEvents)
                .entries({
                    eventId: event.eventId,
                    orderId: event.orderId,
                    correlationId:
                        event.correlationId,
                    eventType:
                        event.eventType ||
                        'SALES_ORDER_APPROVAL_REQUIRED',
                    processedAt: now
                })
        );
    });

    return 'PROCESSED';
}

async function publishRetry(msg, retryCount) {
    const headers = {
        ...(msg.properties.headers || {}),
        'x-retry-count': retryCount
    };

    channel.publish(
        RETRY_EXCHANGE,
        RETRY_ROUTING_KEY,
        msg.content,
        {
            ...msg.properties,
            persistent: true,
            contentType:
                msg.properties.contentType ||
                'application/json',
            headers
        }
    );

    await channel.waitForConfirms();
}

async function handleMessage(db, msg) {
    if (!msg) {
        console.warn(
            'RabbitMQ cancelled the consumer'
        );
        return;
    }

    let event;

    try {
        event = parseEvent(msg);

        console.log(
            `Received event=${event.eventId} correlation=${event.correlationId}`
        );

        const result = await processEvent(db, event);

        channel.ack(msg);

        console.log(
            `${result} event=${event.eventId}`
        );
    } catch (error) {
        console.error(
            `Processing failed for ${event?.eventId || 'UNKNOWN'}:`,
            error.message
        );

        if (error.nonRetryable) {
            await writeFailureRecords(
                db,
                event,
                error,
                0,
                'NON_RETRYABLE'
            );

            channel.nack(msg, false, false);
            return;
        }

        /*
         * If another worker processed the event concurrently,
         * acknowledge this redelivery as a duplicate.
         */
        if (event?.eventId) {
            const processed = await db.run(
                SELECT.one
                    .from(ENTITIES.ProcessedEvents)
                    .where({
                        eventId: event.eventId
                    })
            );

            if (processed) {
                channel.ack(msg);

                console.log(
                    `Concurrent duplicate acknowledged: ${event.eventId}`
                );
                return;
            }
        }

        const currentRetryCount = Number(
            msg.properties.headers?.[
                'x-retry-count'
            ] || 0
        );

        if (currentRetryCount < MAX_RETRIES) {
            const nextRetryCount =
                currentRetryCount + 1;

            try {
                await publishRetry(
                    msg,
                    nextRetryCount
                );

                channel.ack(msg);

                console.log(
                    `Retry scheduled ${nextRetryCount}/${MAX_RETRIES}`
                );
            } catch (publishError) {
                console.error(
                    'Retry publishing was not confirmed:',
                    publishError.message
                );

                channel.nack(msg, false, true);
            }

            return;
        }

        await writeFailureRecords(
            db,
            event,
            error,
            currentRetryCount,
            'RETRIES_EXHAUSTED'
        );

        channel.nack(msg, false, false);
    }
}

async function gracefulShutdown(signal) {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;

    console.log(
        `Received ${signal}; stopping worker`
    );

    try {
        if (channel && consumerTag) {
            await channel.cancel(consumerTag);
        }

        if (channel) {
            await channel.close();
        }

        if (connection) {
            await connection.close();
        }

        await cds.shutdown();

        process.exit(0);
    } catch (error) {
        console.error(
            'Graceful shutdown failed:',
            error.message
        );

        process.exit(1);
    }
}

async function startConsumer() {
    const modelPath = path.join(
        __dirname,
        'db',
        'schema.cds'
    );

    const model = await cds.load(modelPath);
    cds.model = cds.compile.for.nodejs(model);

    const db = await cds.connect.to('db');

    console.log('Connected to database');

    connection = await amqp.connect(
        getRabbitMqUrl()
    );

    connection.on('error', (error) => {
        console.error(
            'RabbitMQ connection error:',
            error.message
        );
    });

    connection.on('close', () => {
        if (!shuttingDown) {
            console.error(
                'RabbitMQ connection closed unexpectedly'
            );

            process.exit(1);
        }
    });

    channel =
        await connection.createConfirmChannel();

    channel.on('error', (error) => {
        console.error(
            'RabbitMQ channel error:',
            error.message
        );
    });

    await initializeTopology(channel);

    const result = await channel.consume(
        QUEUE,
        (msg) => handleMessage(db, msg),
        { noAck: false }
    );

    consumerTag = result.consumerTag;

    console.log(
        `Waiting for messages on ${QUEUE}`
    );
}

process.once(
    'SIGTERM',
    () => gracefulShutdown('SIGTERM')
);

process.once(
    'SIGINT',
    () => gracefulShutdown('SIGINT')
);

startConsumer().catch((error) => {
    console.error(
        'Worker failed to start:',
        error
    );

    process.exit(1);
});
