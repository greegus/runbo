import { describe, expect, it } from 'vitest'

import { authRedirect } from '@/router/authRedirect'

describe('authRedirect', () => {
  it('stays put while the status is still resolving', () => {
    expect(authRedirect('loading', 'signin')).toBeNull()
    expect(authRedirect('loading', 'today')).toBeNull()
    expect(authRedirect('loading', null)).toBeNull()
  })

  // The bug this exists for: sign-in leaves the user on /signin, and the router
  // guard never re-runs because signing in is not a navigation.
  it('leaves the sign-in screen once the account is ready', () => {
    expect(authRedirect('ready', 'signin')).toBe('today')
  })

  it('does not move a ready user who is already inside the app', () => {
    expect(authRedirect('ready', 'today')).toBeNull()
    expect(authRedirect('ready', 'onboarding')).toBeNull()
    expect(authRedirect('ready', 'strength-session')).toBeNull()
  })

  // The first navigation is still pending here, so the guard owns the decision.
  it('does not move a ready user before the first route resolves', () => {
    expect(authRedirect('ready', null)).toBeNull()
  })

  it('sends a signed-out or unlisted account to the sign-in screen', () => {
    expect(authRedirect('signedOut', 'today')).toBe('signin')
    expect(authRedirect('notAllowlisted', 'today')).toBe('signin')
  })

  it('does not re-push the sign-in screen onto itself', () => {
    expect(authRedirect('signedOut', 'signin')).toBeNull()
    expect(authRedirect('notAllowlisted', 'signin')).toBeNull()
  })
})
