import * as assert from 'assert'
import * as E from 'fp-ts/Either'
import { pipe } from 'fp-ts/function'
import * as H from 'hyper-ts'
import * as t from 'io-ts'
import { failure } from 'io-ts/lib/PathReporter'
import { toRequestHandler, fromRequestHandler } from '../src'
import fastify from 'fastify'

describe('FastifyConnection', () => {
  describe('setStatus', () => {
    it('should write the status code', async () => {
      const server = fastify()
      const m = pipe(
        H.status(H.Status.OK),
        H.ichain(() => H.closeHeaders()),
        H.ichain(() => H.end()),
      )
      server.get('/', toRequestHandler(m))

      const res = await server.inject({ path: '/' })
      assert.strictEqual(res.statusCode, 200)
    })
  })

  describe('header', () => {
    it('should write the headers', async () => {
      const server = fastify()
      const m = pipe(
        H.status(H.Status.OK),
        H.ichain(() => H.header('name', 'value')),
        H.ichain(() => H.closeHeaders()),
        H.ichain(() => H.end()),
      )
      server.get('/', toRequestHandler(m))

      const res = await server.inject({ path: '/' })
      assert.strictEqual(res.headers['name'], 'value')
    })
  })

  describe('send', () => {
    it('should send the content', async () => {
      const server = fastify()
      const m = pipe(
        H.status(H.Status.OK),
        H.ichain(() => H.closeHeaders()),
        H.ichain(() => H.send('This is the content')),
      )
      server.get('/', toRequestHandler(m))

      const res = await server.inject({ path: '/' })
      assert.strictEqual(res.body, 'This is the content')
    })
  })

  describe('json', () => {
    it('should add the proper header and send the content', async () => {
      const server = fastify()
      const m = pipe(
        H.status(H.Status.OK),
        H.ichain(() => H.json({ a: 1 }, E.toError)),
      )
      server.get('/', toRequestHandler(m))

      const res = await server.inject({ path: '/' })
      assert.strictEqual(res.body, '{"a":1}')
      assert.strictEqual(res.headers['content-type'], 'application/json; charset=utf-8')
    })
  })

  describe('contentType', () => {
    it('should add the `Content-Type` header', async () => {
      const server = fastify()
      const m = pipe(
        H.status(H.Status.OK),
        H.ichain(() => H.contentType(H.MediaType.applicationXML)),
        H.ichain(() => H.closeHeaders()),
        H.ichain(() => H.end()),
      )
      server.get('/', toRequestHandler(m))

      const res = await server.inject({ path: '/' })
      assert.strictEqual(res.headers['content-type'], 'application/xml')
    })
  })

  describe('redirect', () => {
    it('should add the correct status / header', async () => {
      const server = fastify()
      const m = pipe(
        H.redirect('/users'),
        H.ichain(() => H.closeHeaders()),
        H.ichain(() => H.end()),
      )
      server.get('/', toRequestHandler(m))

      const res = await server.inject({ path: '/' })
      assert.strictEqual(res.statusCode, 302)
      assert.strictEqual(res.headers['location'], '/users')
    })
  })

  describe('decodeQuery', () => {
    it('should validate a query (success case 1)', () => {
      const Query = t.type({ q: t.string })
      const server = fastify()
      const m = pipe(
        H.decodeQuery(Query.decode),
        H.chain((query) => H.rightIO(() => assert.deepStrictEqual(query, { q: 'tobi ferret' }))),
        H.ichain(() => H.status(H.Status.OK)),
        H.ichain(() => H.closeHeaders()),
        H.ichain(() => H.end()),
      )
      server.get('/', toRequestHandler(m))

      return server.inject({ path: '/?q=tobi+ferret' })
    })

    it('should validate a query (success case 2)', () => {
      const Query = t.type({
        order: t.string,
        shoe: t.type({ color: t.string, type: t.string }),
      })
      const server = fastify()
      const m = pipe(
        H.decodeQuery(Query.decode),
        H.chain((query) =>
          H.rightIO(() =>
            assert.deepStrictEqual(query, {
              order: 'desc',
              shoe: { color: 'blue', type: 'converse' },
            }),
          ),
        ),
        H.ichain(() => H.status(H.Status.OK)),
        H.ichain(() => H.closeHeaders()),
        H.ichain(() => H.end()),
      )
      server.get('/', toRequestHandler(m))

      return server.inject({ path: '/?order=desc&shoe[color]=blue&shoe[type]=converse' })
    })

    it('should validate a query (failure case)', async () => {
      const Query = t.type({ q: t.number })
      const server = fastify()
      const m = pipe(
        H.decodeQuery(Query.decode),
        H.ichain(() => H.status(H.Status.OK)),
        H.ichain(() => H.closeHeaders()),
        H.ichain(() => H.end()),
        H.orElse((errors) =>
          pipe(
            H.rightIO(() =>
              assert.deepStrictEqual(failure(errors), [
                'Invalid value "tobi ferret" supplied to : { q: number }/q: number',
              ]),
            ),
            H.ichain(() => H.status(H.Status.BadRequest)),
            H.ichain(() => H.closeHeaders()),
            H.ichain(() => H.end()),
          ),
        ),
      )
      server.get('/', toRequestHandler(m))

      const res = await server.inject({ path: '/?q=tobi ferret' })
      assert.strictEqual(res.statusCode, 400)
    })
  })

  describe('decodeMethod', () => {
    const HttpMethod = t.keyof({
      GET: null,
      POST: null,
    })

    it('should validate the method (success case)', () => {
      const server = fastify()
      const m = pipe(
        H.decodeMethod(HttpMethod.decode),
        H.chain((method) => H.rightIO(() => assert.deepStrictEqual(method, 'GET'))),
        H.ichain(() => H.status(H.Status.OK)),
        H.ichain(() => H.closeHeaders()),
        H.ichain(() => H.end()),
      )
      server.all('/', toRequestHandler(m))

      return server.inject({ path: '/' })
    })

    it('should validate the method (failure case)', async () => {
      const server = fastify()
      const m = pipe(
        H.decodeMethod(HttpMethod.decode),
        H.ichain(() => H.status(H.Status.OK)),
        H.ichain(() => H.closeHeaders()),
        H.ichain(() => H.end()),
        H.orElse((errors) =>
          pipe(
            H.rightIO(() =>
              assert.deepStrictEqual(failure(errors), [
                'Invalid value "PATCH" supplied to : "GET" | "POST"',
              ]),
            ),
            H.ichain(() => H.status(H.Status.MethodNotAllowed)),
            H.ichain(() => H.closeHeaders()),
            H.ichain(() => H.end()),
          ),
        ),
      )
      server.all('/', toRequestHandler(m))

      const res = await server.inject({ method: 'PATCH', path: '/' })
      assert.strictEqual(res.statusCode, 405)
    })
  })

  describe('decodeBody', () => {
    it('should validate the body (success case)', () => {
      const Body = t.type({ x: t.number })
      const server = fastify()
      const m = pipe(
        H.decodeBody(Body.decode),
        H.chain((body) => H.rightIO(() => assert.deepStrictEqual(body, { x: 42 }))),
        H.ichain(() => H.status(H.Status.OK)),
        H.ichain(() => H.closeHeaders()),
        H.ichain(() => H.end()),
      )
      server.get('/', toRequestHandler(m))

      return server.inject({ method: 'post', path: '/', payload: { x: 42 } })
    })

    it('should validate the body (failure case)', () => {
      const Body = t.type({ x: t.number })
      const server = fastify()
      const m = pipe(
        H.decodeBody(Body.decode),
        H.ichain(() => H.status(H.Status.OK)),
        H.ichain(() => H.closeHeaders()),
        H.ichain(() => H.end()),
        H.orElse((errors) =>
          pipe(
            H.rightIO(() =>
              assert.deepStrictEqual(failure(errors), ['Invalid value "a" supplied to : number']),
            ),
            H.ichain(() => H.status(H.Status.BadRequest)),
            H.ichain(() => H.closeHeaders()),
            H.ichain(() => H.end()),
          ),
        ),
      )
      server.get('/', toRequestHandler(m))

      return server.inject({ method: 'post', path: '/', payload: { x: 42 } })
    })
  })

  describe('decodeHeader', () => {
    it('should validate a header (success case)', () => {
      const server = fastify()
      const m = pipe(
        H.decodeHeader('token', t.string.decode),
        H.chain((header) => H.rightIO(() => assert.strictEqual(header, 'mytoken'))),
        H.ichain(() => H.status(H.Status.OK)),
        H.ichain(() => H.closeHeaders()),
        H.ichain(() => H.end()),
      )
      server.get('/', toRequestHandler(m))

      return server.inject({ path: '/', headers: { token: 'mytoken' } })
    })

    it('should validate a header (failure case)', () => {
      const server = fastify()
      const m = pipe(
        H.decodeHeader('token', t.string.decode),
        H.ichain(() => H.status(H.Status.OK)),
        H.ichain(() => H.closeHeaders()),
        H.ichain(() => H.end()),
        H.orElse((errors) =>
          pipe(
            H.rightIO(() =>
              assert.deepStrictEqual(failure(errors), [
                'Invalid value undefined supplied to : string',
              ]),
            ),
            H.ichain(() => H.status(H.Status.BadRequest)),
            H.ichain(() => H.closeHeaders()),
            H.ichain(() => H.end()),
          ),
        ),
      )
      server.get('/', toRequestHandler(m))

      return server.inject({ path: '/' })
    })
  })

  it('should handle the error', async () => {
    const server = fastify()
    const m = pipe(
      H.left<H.StatusOpen, string, void>('error'),
      H.ichain(() => H.status(H.Status.OK)),
      H.ichain(() => H.closeHeaders()),
      H.ichain(() => H.end()),
    )
    server.get('/', toRequestHandler(m))

    const res = await server.inject({ path: '/' })
    assert.strictEqual(res.statusCode, 500)
  })

  describe('fromRequestHandler', () => {
    const server = fastify()
    const someMiddleware: H.Middleware<
      H.StatusOpen,
      H.StatusOpen,
      string,
      void
    > = fromRequestHandler(server)(
      (req) => {
        ;(req as any).error = req.headers['error']
      },
      (req: any) => (req.error ? E.left('oops') : E.right(undefined)),
      () => 'oops',
    )

    const someHandler = pipe(
      someMiddleware,
      H.ichain(() =>
        pipe(
          H.status<string>(H.Status.OK),
          H.ichain(() => H.closeHeaders()),
          H.ichain(() => H.end()),
        ),
      ),
    )

    server.get('/', toRequestHandler(someHandler))

    it('should return 200', async () => {
      const res = await server.inject({ path: '/' })
      assert.strictEqual(res.statusCode, 200)
    })

    it('should return 500', async () => {
      const res = await server.inject({ path: '/', headers: { error: 'boom' } })
      assert.strictEqual(res.statusCode, 500)
    })
  })

  describe('setHeader', () => {
    it('should set a header', async () => {
      const server = fastify()
      const m = pipe(
        H.status(H.Status.OK),
        H.ichain(() => H.header('x-awesome-header', '42')),
        H.ichain(() => H.closeHeaders()),
        H.ichain(() => H.end()),
      )
      server.get('/', toRequestHandler(m))

      const res = await server.inject({ path: '/' })
      assert.strictEqual(res.headers['x-awesome-header'], '42')
    })
  })
})
