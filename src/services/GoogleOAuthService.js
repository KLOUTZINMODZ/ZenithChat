const { OAuth2Client } = require('google-auth-library');
const logger = require('../utils/logger');

class GoogleOAuthService {
  constructor() {
    this.client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
  }

  /**
   * Gera URL de autorização do Google
   * @param {string} state - State único para CSRF protection
   * @returns {string} URL de autorização
   */
  getAuthUrl(state) {
    const scopes = [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'openid'
    ];

    const authUrl = this.client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      state: state,
      prompt: 'consent' // Força consent screen para obter refresh_token
    });

    return authUrl;
  }

  /**
   * Troca authorization code por tokens
   * @param {string} code - Authorization code do Google
   * @returns {Promise<Object>} Tokens e informações do usuário
   */
  async getTokensFromCode(code) {
    try {
      const { tokens } = await this.client.getToken(code);
      return tokens;
    } catch (error) {
      logger.error('Error exchanging code for tokens:', error);
      throw new Error('Failed to exchange authorization code');
    }
  }

  /**
   * Valida e extrai informações do id_token
   * @param {string} idToken - ID token do Google
   * @returns {Promise<Object>} Payload do token verificado
   */
  async verifyIdToken(idToken) {
    try {
      const ticket = await this.client.verifyIdToken({
        idToken: idToken,
        audience: process.env.GOOGLE_CLIENT_ID
      });

      const payload = ticket.getPayload();
      
      // Validações adicionais
      if (!payload.email_verified) {
        throw new Error('Email not verified by Google');
      }

      if (!payload.email) {
        throw new Error('Email not provided by Google');
      }

      return {
        googleId: payload.sub,
        email: payload.email,
        emailVerified: payload.email_verified,
        name: payload.name,
        givenName: payload.given_name,
        familyName: payload.family_name,
        picture: payload.picture,
        locale: payload.locale
      };
    } catch (error) {
      logger.error('Error verifying ID token:', error);
      throw new Error('Invalid ID token');
    }
  }

  /**
   * Obtém informações do usuário usando access token
   * @param {string} accessToken - Access token do Google
   * @returns {Promise<Object>} Informações do usuário
   */
  async getUserInfo(accessToken) {
    try {
      this.client.setCredentials({ access_token: accessToken });
      
      const userInfoResponse = await this.client.request({
        url: 'https://www.googleapis.com/oauth2/v3/userinfo'
      });

      return userInfoResponse.data;
    } catch (error) {
      logger.error('Error fetching user info:', error);
      throw new Error('Failed to fetch user information');
    }
  }

  /**
   * Revoga tokens do Google (logout)
   * @param {string} token - Access token ou refresh token
   * @returns {Promise<boolean>}
   */
  async revokeToken(token) {
    try {
      await this.client.revokeToken(token);
      return true;
    } catch (error) {
      logger.error('Error revoking token:', error);
      return false;
    }
  }
}

module.exports = new GoogleOAuthService();
