/**
 * 会员购买总开关。
 *
 * payment_config/membership_sales 是唯一真身。读取失败时只关闭新购买，
 * 不能阻断会员状态、订单查询、支付查单、权益发放、退款或售后。
 */

const { COLLECTIONS, MembershipSalesState } = require('./schema');

const SALES_CONFIG_ID = 'membership_sales';
const PAUSED_MESSAGE = '会员购买暂停中，已有会员权益、订单和售后不受影响。';
const UNKNOWN_MESSAGE = '会员购买状态确认中，请稍后再试；已有会员权益、订单和售后不受影响。';

function openState() {
  return {
    state: MembershipSalesState.OPEN,
    purchaseEnabled: true,
    message: '',
    reason: '',
    updatedAt: null,
    updatedBy: '',
    readError: false,
  };
}

async function read(db) {
  try {
    const res = await db.collection(COLLECTIONS.PAYMENT_CONFIG)
      .where({ _id: SALES_CONFIG_ID })
      .limit(1)
      .get();
    const current = (res.data || [])[0];
    if (!current) return openState();
    const state = current.state === MembershipSalesState.PAUSED
      ? MembershipSalesState.PAUSED
      : (current.state === MembershipSalesState.OPEN
        ? MembershipSalesState.OPEN
        : MembershipSalesState.PAUSED);
    return {
      state,
      purchaseEnabled: state === MembershipSalesState.OPEN,
      message: state === MembershipSalesState.OPEN ? '' : PAUSED_MESSAGE,
      reason: String(current.reason || ''),
      updatedAt: current.updatedAt || null,
      updatedBy: current.updatedBy || '',
      readError: false,
    };
  } catch (err) {
    return {
      state: MembershipSalesState.PAUSED,
      purchaseEnabled: false,
      message: UNKNOWN_MESSAGE,
      reason: '会员购买配置读取失败',
      updatedAt: null,
      updatedBy: '',
      readError: true,
    };
  }
}

function publicView(current) {
  const source = current || openState();
  return {
    state: source.state,
    purchaseEnabled: source.purchaseEnabled === true,
    message: source.message || '',
  };
}

module.exports = {
  SALES_CONFIG_ID,
  PAUSED_MESSAGE,
  UNKNOWN_MESSAGE,
  openState,
  read,
  publicView,
};
