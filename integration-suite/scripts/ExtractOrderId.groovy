import com.sap.gateway.ip.core.customdev.util.Message
import groovy.json.JsonSlurper
import java.io.Reader

def Message processData(Message message) {

    Reader bodyReader = message.getBody(Reader)

    if (bodyReader == null) {
        throw new IllegalArgumentException(
            'Request payload must not be empty'
        )
    }

    def payload

    try {
        payload = new JsonSlurper().parse(bodyReader)
    } catch (Exception exception) {
        throw new IllegalArgumentException(
            'Request payload must contain valid JSON',
            exception
        )
    }

    String orderId =
        payload?.orderId?.toString()?.trim()

    if (!orderId) {
        throw new IllegalArgumentException(
            'orderId is required'
        )
    }

    if (!(orderId ==~ /[A-Za-z0-9_-]{1,20}/)) {
        throw new IllegalArgumentException(
            'orderId must contain 1-20 letters, numbers, underscores or hyphens'
        )
    }

    message.setProperty(
        'orderId',
        orderId
    )

       message.getHeaders()
        .keySet()
        .findAll { headerName ->
            headerName?.toString()
                ?.toLowerCase()
                ?.contains('authorization')
        }
        .each { headerName ->
            message.setHeader(
                headerName.toString(),
                null
            )
        }

    return message
}