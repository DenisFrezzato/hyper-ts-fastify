import * as fastify from 'fastify'
import * as C from 'fp-ts/lib/Console'
import { fold } from 'fp-ts/lib/Either'
import { constVoid } from 'fp-ts/lib/function'
import { pipe } from 'fp-ts/lib/pipeable'
import * as TE from 'fp-ts/lib/TaskEither'
import { IncomingMessage, ServerResponse } from 'http'
import * as H from 'hyper-ts'

export type LinkedList<A> =
  | { type: 'Nil'; length: number }
  | { type: 'Cons'; head: A; tail: LinkedList<A>; length: number }

export const nil: LinkedList<never> = { type: 'Nil', length: 0 }

export const cons = <A>(head: A, tail: LinkedList<A>): LinkedList<A> => ({
  type: 'Cons',
  head,
  tail,
  length: tail.length + 1,
})

export const toArray = <A>(list: LinkedList<A>): Array<A> => {
  const len = list.length
  const r: Array<A> = new Array(len)
  let l: LinkedList<A> = list
  let i = 1
  while (l.type !== 'Nil') {
    r[len - i] = l.head
    i++
    l = l.tail
  }
  return r
}

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
    readonly req: fastify.FastifyRequest<IncomingMessage>,
    readonly reply: fastify.FastifyReply<ServerResponse>,
    readonly actions: LinkedList<Action> = nil,
    readonly ended: boolean = false,
  ) {}
  public chain<T>(action: Action, ended: boolean = false): FastifyConnection<T> {
    return new FastifyConnection<T>(this.req, this.reply, cons(action, this.actions), ended)
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

const run = (
  reply: fastify.FastifyReply<ServerResponse>,
  action: Action,
): fastify.FastifyReply<ServerResponse> => {
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
      reply.sent = true
      return reply
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
      reply.header(action.name, action.value)
      return reply
    case 'setStatus':
      return reply.status(action.status)
  }
}

const exec = <I, O, L>(
  middleware: H.Middleware<I, O, L, void>,
  req: fastify.FastifyRequest<IncomingMessage>,
  res: fastify.FastifyReply<ServerResponse>,
): Promise<void> =>
  H.execMiddleware(middleware, new FastifyConnection<I>(req, res))().then(e =>
    pipe(
      e,
      fold(constVoid, c => {
        const { actions: list, reply } = c as FastifyConnection<O>
        const len = list.length
        const actions = toArray(list)
        for (let i = 0; i < len; i++) {
          run(reply, actions[i])
        }
      }),
    ),
  )

export function toRequestHandler<I, O, L>(
  middleware: H.Middleware<I, O, L, void>,
): fastify.RequestHandler {
  return (req, res) => exec(middleware, req, res)
}

export function fromRequestHandler(fastifyInstance: fastify.FastifyInstance) {
  return <I = H.StatusOpen, E = never, A = never>(
    requestHandler: fastify.RequestHandler<IncomingMessage>,
    f: (req: fastify.FastifyRequest<IncomingMessage>) => A,
  ): H.Middleware<I, I, E, A> => {
    return c =>
      TE.rightTask(() => {
        const { req, reply: res } = c as FastifyConnection<I>
        return Promise.resolve(requestHandler.call(fastifyInstance, req, res)).then(() => [
          f(req),
          c,
        ])
      })
  }
}
