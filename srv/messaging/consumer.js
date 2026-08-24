require('dotenv').config();
const amqp = require('amqplib');

const QUEUE = 'sales-order-approval.queue';

async function startConsumer() {
  const connection = await amqp.connect(process.env.RABBITMQ_URL);
  const channel = await connection.createChannel();

await channel.assertQueue(QUEUE, {
  durable: true,
  arguments: {
    'x-dead-letter-exchange': 'sales-order-approval.dlx',
    'x-dead-letter-routing-key': 'sales-order-approval.failed'
  }
});

  console.log(`Waiting for messages on ${QUEUE}...`);

  channel.consume(
    QUEUE,
    async (msg) => {
      if (!msg) return;

      try {
        const event = JSON.parse(msg.content.toString());

        console.log('Approval event received:');
        console.log(event);

        // For now, acknowledge after successful parsing.
        channel.ack(msg);
      } catch (error) {
        console.error('Consumer processing failed:', error.message);

        // Do not requeue the bad message for now.
        channel.nack(msg, false, false);
      }
    },
    {
      noAck: false
    }
  );
}

startConsumer().catch((error) => {
  console.error('RabbitMQ consumer failed to start:', error);
  process.exit(1);
});