import com.sap.gateway.ip.core.customdev.util.Message
import java.util.UUID

def Message processData(Message message) {

    def eventId = "EVT-" + UUID.randomUUID().toString()

    message.setProperty("eventId", eventId)

    return message
}