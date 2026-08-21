require('dotenv').config();

const cds = require('@sap/cds');
const amqp = require('amqplib');

const QUEUE = 'sales-order-approval.queue';

async function startConsumer()  {
   const db = await cds.connect.to('db');

    const connection = await amqp.connect(process.env.RABBITMQ_URL);
    const channel = await connection.createChannel();
    await channel.prefetch(1);

    await channel.checkQueue(QUEUE);

    console.log(`Waiting for messages on ${QUEUE}...`);

    channel.consume(
        QUEUE,
        async (msg) => {
            if (!msg) return;

            try {
                const payload = JSON.parse(msg.content.toString());
                if (!payload.eventId) {
    throw new Error('Missing eventId');
}

const existingEvent = await db.run(
    SELECT.one
        .from('sales.approval.ProcessedEvents')
        .where({ eventId: payload.eventId })
);

if (existingEvent) {
    console.log(`Duplicate event ignored: ${payload.eventId}`);
    channel.ack(msg);
    return;
}

                console.log('Received approval event:');
                console.log(payload);

                if (!payload.orderId || !payload.orderValue) {
                    throw new Error('Invalid approval event');
                }

              
               await db.run(
    INSERT.into('sales.approval.ProcessedEvents').entries({
        eventId: payload.eventId,
        orderId: payload.orderId,
        processedAt: new Date().toISOString(),
        status: 'PROCESSED'
    })
);

console.log(
                    `Approval event processed successfully for ${payload.orderId}`
                );


                channel.ack(msg);

            } catch (error) {
                console.error('Processing failed:', error.message);

                const headers = msg.properties.headers || {};
                const retryCount = headers['x-retry-count'] || 0;

                if (retryCount < 3) {
                    console.log(
                        `Retrying message. Attempt ${retryCount + 1} of 3`
                    );

                    channel.publish(
                        'sales-order-approval.retry-exchange',
                        'sales-order-approval.retry',
                        msg.content,
                        {
                            persistent: true,
                            contentType: 'application/json',
                            headers: {
                                ...headers,
                                'x-retry-count': retryCount + 1
                            }
                        }
                    );

                    channel.ack(msg);

                } else {
                    console.error(
                        'Retry limit reached. Sending message to DLQ.'
                    );

                    channel.nack(msg, false, false);
                }
            }
        },
        {
            noAck: false
        }
    );
}

startConsumer().catch((error) => {
    console.error('Consumer failed:', error.message);
    process.exit(1);
});