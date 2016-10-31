const config = require('./config')
const {Swagger, parseAsync} = require('./swagger')
const translate = require('./translate')
const mws = require('./middleware')
const {HttpError, ParameterError} = require('./error')
const logger = require('./logger')
const route = require('./route')
const docs = require('./docs')
const Pipeline = require('./pipeline')
const {wrapRoute, wrapMiddleware} = require('./utility')

exports.createApplicationAsync = createApplicationAsync
exports.HttpError = HttpError
// backward compability
exports.ResponseError = HttpError
exports.ParameterError = ParameterError
exports.translate = translate
exports.parseAsync = parseAsync
exports.logger = logger
exports.config = config
exports.wrapRoute = wrapRoute
exports.wrapMiddleware = wrapMiddleware

async function createApplicationAsync (app, options = {}) {
  const {logger: {file, logstash, sentry} = {}, dynamicDefinition = {}, securityMiddlewares = {}, errorHandler} = options

  logger.initialize({file, logstash, sentry})

  try {
    const api = await Swagger.createAsync(dynamicDefinition)

    app.use((req, res, next) => {
      req.state = {
        version: api.definition.info.version
      }
      const operation = api.getOperation(req)
      req.swagger = {
        operation: operation
      }
      next()
    })

    //
    // Response pipeline
    //

    const pipeline = Pipeline()
    pipeline.use(mws.debug.postHandler())
    // remove response `null` fields
    pipeline.use(mws.validation.response())
    pipeline.use(mws.debug.response())
    app.use(pipeline.createMiddleware())

    //
    // Request pipeline
    //

    // binding request context
    app.use(mws.context(config.target + '/context'))
    // setup swagger documentation
    docs(app, api.definition)
    app.use(mws.switch())
    // request & response logging
    app.use(mws.debug.request())
    // request validation
    app.use(mws.validation.request())
    // security handler
    app.use(mws.security(api, securityMiddlewares, errorHandler))
    // dynamic swagger defined route
    app.use(mws.debug.preHandler())
    route(app, api)
    // 404
    app.use(() => {
      throw new HttpError('NotFound')
    })
    // error handling
    app.use(mws.errorHandler(api, errorHandler))

    return app
  } catch (err) {
    console.log(err.stack) // eslint-disable-line
    process.exit(1)
  }
}

process.on('unhandledRejection', function (reason, p) {
  let err = new Error('Unhandled Promise rejection')
  err.reason = reason
  err.promise = p
  logger.error('Unhandled Rejection at: Promise ', p, ' reason: ', reason)
  logger.error(reason.message, reason.stack)
  throw err
})