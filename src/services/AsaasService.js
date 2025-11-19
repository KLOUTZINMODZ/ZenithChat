const axios = require('axios');
const logger = require('../utils/logger');

class AsaasService {
  constructor() {
    this.baseURL = process.env.ASAAS_API_BASE || 'https://api-sandbox.asaas.com/v3';
    this.apiKey = process.env.ASAAS_API_KEY;
    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Content-Type': 'application/json',
        'access_token': this.apiKey || '',
        'User-Agent': process.env.ASAAS_USER_AGENT || 'ZenithChatApi/1.0.0'
      },
      timeout: 15000
    });
  }

  async getPayment(paymentId) {
    await this.ensureOk();
    const res = await this.client.get(`/payments/${paymentId}`);
    return res.data;
  }

  async ensureOk() {
    if (!this.apiKey) throw new Error('Missing ASAAS_API_KEY');
  }

  formatYMD(date = new Date()) {
    const d = new Date(date);
    const y = d.getFullYear();
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  sanitizeCpfCnpj(v) {
    if (!v) return undefined;
    return String(v).replace(/\D/g, '');
  }

  personTypeFor(doc) {
    const digits = this.sanitizeCpfCnpj(doc);
    if (!digits) return undefined;
    if (digits.length === 11) return 'FISICA';
    if (digits.length === 14) return 'JURIDICA';
    return undefined;
  }

  normalizePixKeyType(type) {
    const t = String(type || '').toUpperCase();
    const map = {
      EMAIL: 'EMAIL',
      CPF: 'CPF',
      CNPJ: 'CNPJ',
      EVP: 'EVP',
      RANDOM: 'EVP',
      KEY: 'EVP',
      PHONE: 'PHONE',
      CELLPHONE: 'PHONE',
      MOBILE: 'PHONE',
      TELEFONE: 'PHONE'
    };
    return map[t] || 'EVP';
  }


  async getOrCreateCustomer({ name, email, cpfCnpj }) {
    await this.ensureOk();
    try {

      const doc = this.sanitizeCpfCnpj(cpfCnpj);
      if (doc) {
        try {
          const byDoc = await this.client.get('/customers', { params: { cpfCnpj: doc } });
          const dataDoc = byDoc?.data;
          if (dataDoc && dataDoc.data && dataDoc.data.length > 0) {
            return dataDoc.data[0];
          }
        } catch (e) {
          logger.warn('Asaas: get customers by cpfCnpj failed', { message: e.message });
        }
      }


      if (email) {
        const found = await this.client.get('/customers', { params: { email } });
        const data = found?.data;
        if (data && data.data && data.data.length > 0) {
          let existing = data.data[0];

          const sanitized = this.sanitizeCpfCnpj(cpfCnpj);
          if (sanitized && existing.cpfCnpj !== sanitized) {
            try {
              const fields = { cpfCnpj: sanitized };
              const ptype = this.personTypeFor(sanitized);
              if (ptype) fields.personType = ptype;
              await this.updateCustomer(existing.id, fields);

              existing = await this.getCustomer(existing.id);
            } catch (e) {
              logger.warn('Asaas: failed to update customer cpfCnpj', { message: e.message });
            }
          }
          return existing;
        }
      }
    } catch (e) {
      logger.warn('Asaas: get customers failed, will try to create', { message: e.message });
    }


    const payload = { name, email };
    const sanitized = this.sanitizeCpfCnpj(cpfCnpj);
    if (sanitized) {
      payload.cpfCnpj = sanitized;
      const ptype = this.personTypeFor(sanitized);
      if (ptype) payload.personType = ptype;
    }
    const created = await this.client.post('/customers', payload);
    return created.data;
  }

  async updateCustomer(customerId, fields) {
    await this.ensureOk();
    const res = await this.client.put(`/customers/${customerId}`, fields);
    return res.data;
  }

  async getCustomer(customerId) {
    await this.ensureOk();
    const res = await this.client.get(`/customers/${customerId}`);
    return res.data;
  }

  async ensureCustomerHasCpfCnpj(customerId, cpfCnpj) {
    await this.ensureOk();
    const doc = this.sanitizeCpfCnpj(cpfCnpj);
    try {

      if (!doc) {
        return await this.getCustomer(customerId);
      }


      let current;
      try {
        current = await this.getCustomer(customerId);
      } catch (e) {
        logger.warn('Asaas: getCustomer before ensure cpfCnpj failed', { message: e.message });
      }

      if (current && current.cpfCnpj === doc) {
        return current;
      }


      try {
        const fields = { cpfCnpj: doc };
        const ptype = this.personTypeFor(doc);
        if (ptype) fields.personType = ptype;
        await this.updateCustomer(customerId, fields);
        return await this.getCustomer(customerId);
      } catch (e) {
        logger.warn('Asaas: updateCustomer cpfCnpj failed, will try search by document', { message: e.message });
      }


      try {
        const byDoc = await this.client.get('/customers', { params: { cpfCnpj: doc } });
        const list = byDoc?.data?.data || [];
        if (list.length > 0) {
          return list[0];
        }
      } catch (e2) {
        logger.warn('Asaas: search by document after failed update also failed', { message: e2.message });
      }


      return current || { id: customerId };
    } catch (err) {
      logger.warn('Asaas: ensureCustomerHasCpfCnpj unexpected error', { message: err.message });
      return { id: customerId };
    }
  }


  async createPixPayment({ customerId, value, description, externalReference, dueDate }) {
    await this.ensureOk();
    const payload = {
      customer: customerId,
      billingType: 'PIX',
      value: Number(value),
      description,
      externalReference
    };

    payload.dueDate = dueDate || this.formatYMD(new Date());
    const res = await this.client.post('/payments', payload);
    return res.data;
  }

  async getPixQrCode(paymentId) {
    await this.ensureOk();
    const res = await this.client.get(`/payments/${paymentId}/pixQrCode`);
    return res.data;
  }

  async getPixQrCodeWithRetry(paymentId, { attempts = 3, delayMs = 1200, timeoutMs = 20000 } = {}) {
    await this.ensureOk();
    let lastError;
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await this.client.get(`/payments/${paymentId}/pixQrCode`, { timeout: timeoutMs });
        return res.data;
      } catch (e) {
        lastError = e;
        const status = e?.response?.status;
        const code = e?.code;

        const shouldRetry = code === 'ECONNABORTED' || !status || status >= 500 || status === 400 || status === 404 || status === 409;
        if (shouldRetry && i < attempts - 1) {
          await new Promise(r => setTimeout(r, delayMs * (i + 1)));
          continue;
        }
        throw e;
      }
    }
    throw lastError;
  }


  async createPixTransfer({ value, pixAddressKey, pixAddressKeyType, description, scheduleDate, externalReference }) {
    await this.ensureOk();
    const type = this.normalizePixKeyType(pixAddressKeyType);
    let key = pixAddressKey;

    const allowed = new Set(['PHONE', 'CPF', 'CNPJ']);
    if (!allowed.has(type)) {
      const err = new Error('Unsupported pix key type by policy (allowed: PHONE, CPF, CNPJ)');
      err.code = 'UNSUPPORTED_PIX_KEY_TYPE';
      throw err;
    }
    if (type === 'PHONE') {
      key = String(pixAddressKey || '').replace(/\D/g, '');
    } else if (type === 'CPF' || type === 'CNPJ') {
      key = this.sanitizeCpfCnpj(pixAddressKey);
    }
    const payload = {
      value: Number(value),
      pixAddressKey: key,
      pixAddressKeyType: type,
      description
    };
    if (externalReference) payload.externalReference = externalReference;
    if (scheduleDate) payload.scheduleDate = scheduleDate;
    const res = await this.client.post('/transfers', payload);
    return res.data;
  }

  async findTransferByExternalReference(externalReference) {
    await this.ensureOk();
    if (!externalReference) return null;
    try {
      const res = await this.client.get('/transfers', { params: { externalReference } });
      const list = res?.data?.data || [];
      return list.length > 0 ? list[0] : null;
    } catch (e) {
      logger.warn('Asaas: findTransferByExternalReference failed', { message: e.message });
      return null;
    }
  }

  async createPixTransferWithRetry({ value, pixAddressKey, pixAddressKeyType, description, scheduleDate, externalReference }, { attempts = 1, delayMs = 800, timeoutMs = 8000 } = {}) {
    await this.ensureOk();
    const type = this.normalizePixKeyType(pixAddressKeyType);
    let key = pixAddressKey;

    const allowed = new Set(['PHONE', 'CPF', 'CNPJ']);
    if (!allowed.has(type)) {
      const err = new Error('Unsupported pix key type by policy (allowed: PHONE, CPF, CNPJ)');
      err.code = 'UNSUPPORTED_PIX_KEY_TYPE';
      throw err;
    }
    if (type === 'PHONE') key = String(pixAddressKey || '').replace(/\D/g, '');
    else if (type === 'CPF' || type === 'CNPJ') key = this.sanitizeCpfCnpj(pixAddressKey);

    const payload = {
      value: Number(value),
      pixAddressKey: key,
      pixAddressKeyType: type,
      description
    };
    if (externalReference) payload.externalReference = externalReference;
    if (scheduleDate) payload.scheduleDate = scheduleDate;

    let lastError;
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await this.client.post('/transfers', payload, { timeout: timeoutMs });
        return res.data;
      } catch (e) {
        lastError = e;
        const status = e?.response?.status;
        const desc = e?.response?.data?.errors?.[0]?.description || e?.message || '';
        const code = e?.code;


        if (status === 409 || /já solicitado|already requested/i.test(desc)) {
          const found = await this.findTransferByExternalReference(externalReference);
          if (found) return found;
        }

        const transient = code === 'ECONNABORTED' || !status || status >= 500 || status === 408;
        if (transient) {

          const found = await this.findTransferByExternalReference(externalReference);
          if (found) return found;
          if (i < attempts - 1) {
            await new Promise(r => setTimeout(r, delayMs * (i + 1)));
            continue;
          }
        }
        throw e;
      }
    }
    throw lastError;
  }

  async getTransferWithTimeout(transferId, timeoutMs = 8000) {
    await this.ensureOk();
    const res = await this.client.get(`/transfers/${transferId}`, { timeout: timeoutMs });
    return res.data;
  }

  async getTransfer(transferId) {
    await this.ensureOk();
    const res = await this.client.get(`/transfers/${transferId}`);
    return res.data;
  }


  async createWalletTransfer({ value, walletId, description, scheduleDate }) {
    await this.ensureOk();
    const allowed = (process.env.ASAAS_ALLOWED_DEST_WALLET_IDS || process.env.ASAAS_SELF_WALLET_ID || '')
      .split(/[ ,;]+/)
      .map(s => String(s || '').trim())
      .filter(Boolean);
    if (allowed.length > 0 && walletId && !allowed.includes(walletId)) {
      throw new Error('Destination walletId not allowed by policy');
    }
    const payload = {
      value: Number(value),
      walletId,
      description
    };
    if (scheduleDate) payload.scheduleDate = scheduleDate;
    const res = await this.client.post('/transfers', payload);
    return res.data;
  }
}

module.exports = new AsaasService();
