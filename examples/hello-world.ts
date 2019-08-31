import * as fastify from 'fastify'
import 'fastify-cookie'
import { pipe } from 'fp-ts/lib/pipeable'
import * as H from 'hyper-ts'

import { toRequestHandler } from '../src'

const hello: H.Middleware<H.StatusOpen, H.ResponseEnded, never, void> = pipe(
  H.status(H.Status.OK), // writes the response status
  H.ichain(() => H.closeHeaders()), // tells hyper-ts that we're done with the headers
  H.ichain(() => H.send('Hello hyper-ts on fastify!')), // sends the response as text
)

fastify()
  .get('/', toRequestHandler(hello))
  // tslint:disable-next-line: no-console
  .listen(3000, () => console.log('Fastify listening on port 3000. Use: GET /'))
