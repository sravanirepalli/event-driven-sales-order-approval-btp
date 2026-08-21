const amqp = require('amqplib');

let connection;
let channel;

async function getChannel() {
    if (channel) {
        return channel;
    }

    connection = await amqp.connect(process.env.RABBITMQ_URL);
    channel = await connection.createChannel();

    return channel;
}

async function publishApprovalEvent(message) {
    const ch = await getChannel();

    const queue = 'sales-order-approval.queue';

   const dlx = 'sales-order-approval.dlx';
const dlq = 'sales-order-approval.dlq';

await ch.assertExchange(dlx, 'direct', {
    durable: true
});

await ch.assertQueue(dlq, {
    durable: true
});

await ch.bindQueue(
    dlq,
    dlx,
    'sales-order-approval.failed'
);
const retryExchange = 'sales-order-approval.retry-exchange';
const retryQueue = 'sales-order-approval.retry';

await ch.assertExchange(retryExchange, 'direct', {
    durable: true
});

await ch.assertQueue(retryQueue, {
    durable: true,
    arguments: {
        'x-message-ttl': 5000,
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': queue
    }
});

await ch.bindQueue(
    retryQueue,
    retryExchange,
    'sales-order-approval.retry'
);
await ch.assertQueue(queue, {
    durable: true,
    arguments: {
        'x-dead-letter-exchange': dlx,
        'x-dead-letter-routing-key': 'sales-order-approval.failed'
    }
});
if (!message.eventId) {
    message.eventId = `EVT-${message.orderId}-${Date.now()}`;
}

    ch.sendToQueue(
        queue,
        Buffer.from(JSON.stringify(message)),
        {
            persistent: true,
            contentType: 'application/json'
        }
    );

    console.log(`Published approval event for order ${message.orderId}`);
}

module.exports = {
    publishApprovalEvent
};