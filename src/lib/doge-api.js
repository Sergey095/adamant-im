import coininfo from 'coininfo'
import bitcoin from 'bitcoinjs-lib'
import axios from 'axios'

import { Cryptos } from './constants'
import getEnpointUrl from './getEndpointUrl'

const fmt = coininfo.dogecoin.main.toBitcoinJS()
const network = {
  messagePrefix: '\x19' + fmt.name + ' Signed Message:\n',
  bip32: {
    public: fmt.bip32.public,
    private: fmt.bip32.private
  },
  pubKeyHash: fmt.pubKeyHash,
  scriptHash: fmt.scriptHash,
  wif: fmt.wif
}

const MULTIPLIER = 1e8
const TX_FEE = 1 // 1 DOGE per transaction

export default class DogeApi {
  constructor (passphrase) {
    const pwHash = bitcoin.crypto.sha256(Buffer.from(passphrase))
    this._keyPair = bitcoin.ECPair.fromPrivateKey(pwHash, { network })
    this._address = bitcoin.payments.p2pkh({ pubkey: this._keyPair.publicKey, network }).address
    this._clients = { }
  }

  /** Dogecoin public address */
  get address () {
    return this._address
  }

  /**
   * Returns confirmed Doge balance
   * @returns {Promise<string>}
   */
  getBalance () {
    return this._get(`/addr/${this.address}/balance`)
      .then(({ data }) => data && data.confirmed_balance)
  }

  /**
   * Creates a DOGE transfer transaction hex and ID
   * @param {string} address receiver address
   * @param {number} amount amount to transfer (DOGEs)
   * @returns {{hex: string, txid: string}}
   */
  createTransaction (address = '', amount = 0) {
    amount = Math.floor(Number(amount) * MULTIPLIER)

    return this._get(`/addr/${this.address}/utxo?noCache=1`)
      .then(unspents => {
        const hex = this._buildTransaction(address, amount, unspents)

        let txid = bitcoin.crypto.sha256(Buffer.from(hex, 'hex'))
        txid = bitcoin.crypto.sha256(Buffer.from(txid))
        txid = txid.toString('hex').match(/.{2}/g).reverse().join('')

        return { hex, txid }
      })
  }

  /**
   * Broadcasts the specified transaction to the DOGE network.
   * @param {string} txHex raw transaction as a HEX literal
   */
  sendTransaction (txHex) {
    return this._post('/tx/send', { rawtx: txHex })
  }

  /**
   * Creates a raw DOGE transaction as a hex string.
   * @param {string} address target address
   * @param {number} amount amount to send
   * @param {Array<{txid: string, amount: number}>} unspents unspent transaction to use as inputs
   * @returns {string}
   */
  _buildTransaction (address, amount, unspents) {
    const txb = new bitcoin.TransactionBuilder(network)
    txb.setVersion(1)

    const target = (amount + TX_FEE) * MULTIPLIER
    let transferAmount = 0
    let inputs = 0

    unspents.forEach(tx => {
      const amount = Math.floor(tx.amount * MULTIPLIER)
      if (transferAmount < target) {
        txb.addInput(tx.txid, inputs++)
        transferAmount += amount
      }
    })

    txb.addOutput(address, amount)
    txb.addOutput(this._address, transferAmount - target)

    for (let i = 0; i < inputs; ++i) {
      txb.sign(i, this._keyPair)
    }

    return txb.build().toHex()
  }

  /** Executes a GET request to the DOGE API */
  _get (url, params) {
    return this._getClient().get(url, params).then(response => response.data)
  }

  /** Executes a POST request to the DOGE API */
  _post (url, data) {
    const fd = Object.keys(data).reduce((form, key) => {
      form.append(key, data[key])
      return form
    }, new FormData())

    return this._getClient().post(url, fd).then(response => response.data)
  }

  /** Picks a client for a random DOGE API endpoint */
  _getClient () {
    const url = getEnpointUrl(Cryptos.DOGE)
    if (!this._clients[url]) {
      this._clients = axios.create({
        baseURL: url
      })
    }
    return this._clients[url]
  }
}
