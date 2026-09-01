import com.sap.gateway.ip.core.customdev.util.Message
import groovy.json.JsonSlurper
import java.io.Reader

def Message processData(Message message) {

    Reader bodyReader = message.getBody(Reader)

    if (bodyReader == null) {
        throw new IllegalArgumentException(
            'CAP response body must not be empty'
        )
    }

    def response

    try {
        response = new JsonSlurper().parse(bodyReader)
    } catch (Exception exception) {
        throw new IllegalArgumentException(
            'CAP returned an invalid JSON response',
            exception
        )
    }

    if (!(response.approvalRequired instanceof Boolean)) {
        throw new IllegalArgumentException(
            'CAP response is missing a valid approvalRequired boolean'
        )
    }

    String eventId = response.eventId?.toString()?.trim()
    String correlationId =
        response.correlationId?.toString()?.trim()

    if (!eventId) {
        throw new IllegalArgumentException(
            'CAP response is missing eventId'
        )
    }

    if (!correlationId) {
        throw new IllegalArgumentException(
            'CAP response is missing correlationId'
        )
    }

    message.setProperty(
        'approvalRequired',
        response.approvalRequired
    )

    message.setProperty(
        'eventId',
        eventId
    )

    message.setProperty(
        'correlationId',
        correlationId
    )

    message.setProperty(
        'approvalPath',
        response.approvalPath?.toString() ?: 'NONE'
    )

    message.setProperty(
        'reason',
        response.reason?.toString() ?: 'UNKNOWN'
    )

    return message
}