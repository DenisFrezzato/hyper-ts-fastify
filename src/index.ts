import * as F from 'fastify'
import * as LL from 'fp-ts-contrib/lib/List'
import * as C from 'fp-ts/Console'
import * as E from 'fp-ts/Either'
import { IncomingMessage } from 'http'
import * as H from 'hyper-ts'
import { pipe, flow } from 'fp-ts/function'

export type Action =
  | { type: 'setBody'; body: unknown }
  | { type: 'endResponse' }
  | { type: 'setStatus'; status: H.Status }
  | { type: 'setHeader'; name: string; value: string }
  | { type: 'clearCookie'; name: string; options: H.CookieOptions }
  | { type: 'setCookie'; name: string; value: string; options: H.CookieOptions }

const endResponse: Action = { type: 'endResponse' }

const missingCookiePluginWarn = () =>
  C.warn('You need to install fastify-cookie in order to use setCookie.')

export class FastifyConnection<S> implements H.Connection<S> {
  public readonly _S!: S
  constructor(
    readonly req: F.FastifyRequest,
    readonly reply: F.FastifyReply,
    readonly actions: LL.List<Action> = LL.nil,
    readonly ended: boolean = false,
  ) {}
  public chain<T>(action: Action, ended: boolean = false): FastifyConnection<T> {
    return new FastifyConnection<T>(this.req, this.reply, LL.cons(action, this.actions), ended)
  }
  public getRequest(): IncomingMessage {
    return this.req.raw
  }
  public getBody(): unknown {
    return this.req.body
  }
  public getHeader(name: string): unknown {
    return this.req.headers[name]
  }
  public getParams(): unknown {
    return this.req.params
  }
  public getQuery(): unknown {
    return this.req.query
  }
  public getOriginalUrl(): string {
    // http.IncomingMessage is created by http.Server or http.ClientRequest.
    // https://nodejs.org/api/http.html#http_class_http_incomingmessage
    // Since it's created by http.Server, the url property is not undefined.
    return this.req.raw.url!
  }
  public getMethod(): string {
    // See getOriginalUrl.
    return this.req.raw.method!
  }
  public setCookie(
    name: string,
    value: string,
    options: H.CookieOptions,
  ): FastifyConnection<H.HeadersOpen> {
    return this.chain({ type: 'setCookie', name, value, options })
  }
  public clearCookie(name: string, options: H.CookieOptions): FastifyConnection<H.HeadersOpen> {
    return this.chain({ type: 'clearCookie', name, options })
  }
  public setHeader(name: string, value: string): FastifyConnection<H.HeadersOpen> {
    return this.chain({ type: 'setHeader', name, value })
  }
  public setStatus(status: H.Status): FastifyConnection<H.HeadersOpen> {
    return this.chain({ type: 'setStatus', status })
  }
  public setBody(body: unknown): FastifyConnection<H.ResponseEnded> {
    return this.chain({ type: 'setBody', body }, true)
  }
  public endResponse(): FastifyConnection<H.ResponseEnded> {
    return this.chain(endResponse, true)
  }
}

const run = (reply: F.FastifyReply, action: Action): F.FastifyReply => {
  switch (action.type) {
    case 'clearCookie':
      // tslint:disable-next-line strict-boolean-expressions
      if (reply.setCookie) {
        return reply.setCookie(action.name, '', {
          expires: new Date(1),
          path: '/',
          ...action.options,
        })
      } else {
        missingCookiePluginWarn()
        return reply
      }
    case 'endResponse':
      return reply.send()
    case 'setBody':
      return reply.send(action.body)
    case 'setCookie':
      // tslint:disable-next-line strict-boolean-expressions
      if (reply.setCookie) {
        return reply.setCookie(action.name, action.value, action.options)
      } else {
        missingCookiePluginWarn()
        return reply
      }
    case 'setHeader':
      return reply.header(action.name, action.value)
    case 'setStatus':
      return reply.status(action.status)
  }
}

const exec = <I, O, L>(middleware: H.Middleware<I, O, L, void>): F.RouteHandler => (
  req,
  reply,
): Promise<void> =>
  H.execMiddleware(middleware, new FastifyConnection<I>(req, reply, LL.nil, reply.sent))().then(
    E.fold(
      () => {
        reply.status(500).send()
      },
      (c) => {
        const { actions: list, reply } = c as FastifyConnection<O>
        const len = list.length
        const actions = LL.toReversedArray(list)
        for (let i = 0; i < len; i++) {
          run(reply, actions[i])
        }
      },
    ),
  )

export const toRequestHandler = <I, O, L>(
  middleware: H.Middleware<I, O, L, void>,
): F.RouteHandler => exec(middleware)

export const fromRequestHandler = (fastifyInstance: F.FastifyInstance) => <
  I = H.StatusOpen,
  E = never,
  A = never
>(
  requestHandler: F.RouteHandler,
  f: (req: F.FastifyRequest) => E.Either<E, A>,
  onError: (reason: unknown) => E,
): H.Middleware<I, I, E, A> => (c) => () => {
  const { req, reply: res } = c as FastifyConnection<I>
  return Promise.resolve(requestHandler.call(fastifyInstance, req, res))
    .then(() =>
      pipe(
        req,
        f,
        E.map((a): [A, H.Connection<I>] => [a, c]),
      ),
    )
    .catch(flow(onError, E.left))
}
