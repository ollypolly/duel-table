export class SessionError extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 501
  readonly details?: string[]
  constructor(status: 400 | 401 | 403 | 404 | 409 | 422 | 501, message: string, details?: string[]) {
    super(message)
    this.status = status
    this.details = details
  }
}
