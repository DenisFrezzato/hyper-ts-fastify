import { fastify } from 'fastify'
import 'fastify-cookie'
import { pipe } from 'fp-ts/lib/pipeable'
import * as H from 'hyper-ts'
import { NonEmptyString } from 'io-ts-types/lib/NonEmptyString'

import { toRequestHandler } from '../src'

//
// model
//

interface User {
  name: string
}

//
// business logic
//

const UserNotFound = 'UserNotFound' as const

const InvalidArguments = 'InvalidArguments' as const

const JSONError = 'JSONError' as const

type UserError = typeof InvalidArguments | typeof UserNotFound | typeof JSONError

/** Parses the `user_id` param */
const getUserId: H.Middleware<H.StatusOpen, H.StatusOpen, UserError, NonEmptyString> = pipe(
  H.decodeParam('user_id', NonEmptyString.decode),
  H.mapLeft(() => InvalidArguments),
)

/** Loads a `User` from a database (fake) */
function loadUser(
  userId: NonEmptyString,
): H.Middleware<H.StatusOpen, H.StatusOpen, UserError, User> {
  return userId === 'ab' ? H.right({ name: 'User name...' }) : H.left(UserNotFound)
}

/** Sends a `User` to the client */
function sendUser(user: User): H.Middleware<H.StatusOpen, H.ResponseEnded, UserError, void> {
  return pipe(
    H.status(H.Status.OK),
    H.ichain(() => H.json(user, () => JSONError)),
  )
}

const getUser: H.Middleware<H.StatusOpen, H.ResponseEnded, UserError, void> = pipe(
  getUserId,
  H.ichain(loadUser),
  H.ichain(sendUser),
)

//
// error handling
//

function badRequest<E = never>(
  message: string,
): H.Middleware<H.StatusOpen, H.ResponseEnded, E, void> {
  return pipe(
    H.status(H.Status.BadRequest),
    H.ichain(() => H.closeHeaders()),
    H.ichain(() => H.send(message)),
  )
}

function notFound<E = never>(
  message: string,
): H.Middleware<H.StatusOpen, H.ResponseEnded, E, void> {
  return pipe(
    H.status(H.Status.NotFound),
    H.ichain(() => H.closeHeaders()),
    H.ichain(() => H.send(message)),
  )
}

function serverError<E = never>(
  message: string,
): H.Middleware<H.StatusOpen, H.ResponseEnded, E, void> {
  return pipe(
    H.status(H.Status.InternalServerError),
    H.ichain(() => H.closeHeaders()),
    H.ichain(() => H.send(message)),
  )
}

function sendError(err: UserError): H.Middleware<H.StatusOpen, H.ResponseEnded, never, void> {
  switch (err) {
    case 'UserNotFound':
      return notFound('user not found')
    case 'InvalidArguments':
      return badRequest('invalid arguments')
    case 'JSONError':
      return serverError('invalid JSON')
  }
}

//
// route
//

const getUserHandler = pipe(getUser, H.orElse(sendError))

fastify()
  .get('/:user_id', toRequestHandler(getUserHandler))
  // tslint:disable-next-line: no-console
  .listen(3000, () => console.log('Fastify listening on port 3000. Use: GET /:user_id'))
