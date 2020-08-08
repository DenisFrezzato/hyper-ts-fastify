import { fastify } from 'fastify'
import 'fastify-cookie'
import { pipe } from 'fp-ts/function'
import * as H from 'hyper-ts'

import { toRequestHandler } from '../src'

const hello = pipe(
  H.status(H.Status.OK),
  H.ichain(() => H.json({ message: 'Hello world!' }, () => 'error')),
)

fastify()
  .get('/', toRequestHandler(hello))
  // tslint:disable-next-line: no-console
  .listen(3000, () => console.log('Fastify listening on port 3000. Use: GET /'))
