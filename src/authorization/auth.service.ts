import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { FileUpload } from 'graphql-upload'

import type { Connection, SendPhoneResponse, SignInInput } from 'types/graphql'

import { FirebaseService } from 'firebase/firebase.service'
import { UserService } from 'users/users.service'
import { MediaService } from 'media/media.service'

import { SessionService } from 'sessions/sessions.service'
import type { SessionData } from 'sessions/sessions.type'

import type { AuthCheckTwoFa, SessionJwtPayload, SignUpInput } from './auth.type'
import { Session, TwoFaAuth } from '@prisma/client'
import { GraphQLError } from 'graphql'
@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly firebaseService: FirebaseService,
    private readonly mediaService: MediaService,
    private readonly sessionService: SessionService,
    private readonly jwtService: JwtService,
  ) {}

  public async sendPhone(phoneNumber: string): Promise<SendPhoneResponse> {
    const user = await this.userService.getByPhone(phoneNumber)

    return {
      userId: user?.id,
    }
  }

  public async getTwoFa(token: string): Promise<AuthCheckTwoFa | null> {
    const verified = await this.firebaseService.auth.verifyIdToken(token)
    if (!verified.phone_number) {
      throw new Error('Verify firebase token error')
    }
    const user = await this.userService.getTwoFaByPhone(verified.phone_number)
    if (!user) {
      return null
    }

    return user.twoFaAuth
  }

  public async signUp(input: SignUpInput, photo?: FileUpload) {
    const { connection, firstName, lastName, silent, token, phoneNumber } = input
    /* Validate token, if not valid - throw error */
    let photoUrl: string | undefined
    if (photo) {
      const photoName = (firstName + ' ' + lastName || '').toLowerCase().replace(/\s+/g, '-') + Date.now()
      photoUrl = await this.mediaService.uploadPhoto(photo, `avatars/${photoName}`)
    }

    const sessionData: SessionData = {
      ip: connection.ipAddress,
      country: connection.countryName,
      region: connection.cityName + ' ' + connection.regionName,
      platform: connection.platform || 'unknown',
      browser: connection.browser || 'unknown',
    }

    const user = await this.userService.create({
      firstName,
      lastName,
      phoneNumber,
      photoUrl,
      sessionData,
    })

    const session = await this.sessionService.create(sessionData, user.id)
    return { session }
  }

  public async signIn(input: SignInInput) {
    /* validate token */
    /* if valid, then return session */
    const user = await this.userService.getById(input.userId)
    if (!user) {
      throw new Error('User not found')
    }
    const verified = await this.firebaseService.auth.verifyIdToken(input.token)
    if (verified.phone_number !== user.phoneNumber) {
      console.log('Token invalid')
      throw new Error('Token invalid')
      return
    }

    const session = await this.sessionService.create(this.getSessionData(input.connection), input.userId)

    return { session: this.encodeSession(session) }
  }

  private async verifyToken(token: string) {
    return token
  }

  private getSessionData(connection: Connection) {
    return {
      ip: connection.ipAddress,
      country: connection.countryName,
      region: connection.cityName + ' ' + connection.regionName,
      platform: connection.platform || 'unknown',
      browser: connection.browser || 'unknown',
    }
  }

  private encodeSession(session: Session) {
    return this.jwtService.sign({
      id: session.id,
      userId: session.userId,
    })
  }

  private decodeSession(token: string) {
    return this.jwtService.decode(token) as SessionJwtPayload
  }
}
