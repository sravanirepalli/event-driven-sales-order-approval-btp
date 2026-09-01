import com.sap.gateway.ip.core.customdev.util.Message
import groovy.json.JsonOutput

def Message processData(Message message) {

    Throwable exception =
        message.getProperty('CamelExceptionCaught') as Throwable

    String errorMessage =
        exception?.message?.trim() ?:
        exception?.toString() ?:
        'Unknown integration processing error'

    String errorCode =
        exception?.class?.simpleName ?:
        'IFLOW_PROCESSING_ERROR'

    String failedStep =
        message.getProperty('CamelFailureEndpoint')?.toString() ?:
        message.getProperty('CamelFailureRouteId')?.toString() ?:
        'UNKNOWN_STEP'

    String correlationId =
        message.getProperty('correlationId')?.toString() ?:
        message.getHeader('X-Correlation-ID', String) ?:
        message.getHeader('SAP_MessageProcessingLogID', String) ?:
        'UNKNOWN_CORRELATION_ID'

    boolean retryable = false
    boolean invalidRequest = false
    Throwable cause = exception

    while (cause != null) {

        if (
            cause instanceof java.net.SocketTimeoutException ||
            cause instanceof java.net.ConnectException
        ) {
            retryable = true
        }

        if (cause instanceof IllegalArgumentException) {
            invalidRequest = true
        }

        cause = cause.cause
    }

    int retryCount = 0
    def retryCountValue =
        message.getProperty('retryCount')

    if (retryCountValue != null) {
        try {
            retryCount =
                retryCountValue.toString().toInteger()
        } catch (Exception ignored) {
            retryCount = 0
        }
    }

    int clientHttpStatus =
        invalidRequest ? 400 : 500

    String clientErrorCode =
        invalidRequest ?
            'INVALID_REQUEST' :
            'PROCESSING_FAILED'

    String clientErrorMessage =
        invalidRequest ?
            errorMessage :
            'The request could not be processed'

    message.setProperty(
        'correlationId',
        correlationId
    )

    message.setProperty(
        'errorHttpStatus',
        clientHttpStatus
    )

    message.setProperty(
        'clientErrorCode',
        clientErrorCode
    )

    message.setProperty(
        'clientErrorMessage',
        clientErrorMessage
    )

    Map errorPayload = [
        integrationFlow:
            message.getProperty('integrationFlow')?.toString() ?:
            'Sales_Order_Approval_Request_V2',

        orderId:
            message.getProperty('orderId')?.toString(),

        eventId:
            message.getProperty('eventId')?.toString(),

        correlationId:
            correlationId,

        component:
            'SAP_INTEGRATION_SUITE',

        errorCode:
            errorCode,

        errorMessage:
            errorMessage,

        failedStep:
            failedStep,

        status:
            'FAILED',

        retryable:
            retryable,

        retryCount:
            retryCount
    ]

    message.setBody(
        JsonOutput.toJson(errorPayload)
    )

    message.setHeader(
        'Content-Type',
        'application/json'
    )

    return message
}