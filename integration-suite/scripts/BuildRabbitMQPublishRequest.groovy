import com.sap.gateway.ip.core.customdev.util.Message
import groovy.json.JsonOutput

def Message processData(Message message) {
    String eventPayload = message.getBody(String)

    def publishRequest = [
        properties      : [content_type: 'application/json'],
        routing_key     : 'sales-order-approval.queue',
        payload         : eventPayload,
        payload_encoding: 'string'
    ]

    message.setBody(JsonOutput.toJson(publishRequest))
    message.setHeader('Content-Type', 'application/json')

    return message
}