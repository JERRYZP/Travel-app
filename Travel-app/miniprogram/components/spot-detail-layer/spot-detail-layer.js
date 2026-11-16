const reminderFlow = require('../../utils/reminder-flow.js');

Component({
  properties: {
    show: { type: Boolean, value: false },
    spotId: { type: String, value: '' },
  },

  observers: {
    show(value) {
      this.setData({ showSpotPopup: !!value });
    },
  },

  data: {
    showSpotPopup: false,
    entryContext: null,
    showDateSheet: false,
    dateSpotName: '',
    dateTitle: '',
    dateTripDates: [],
    dateBookedDates: [],
    dateMinDate: '',
    dateAction: null,
    dateMultiple: false,
    showReminderAuth: false,
    reminderAuth: null,
    datePlan: null,
    reminderAuthBusy: false,
    reminderAuthFeedback: '',
    reminderCheckoutReady: false,
    reminderContinueText: '开启行程放票提醒',
    membershipLimit: null,
    taskLimitPayConfirm: null,
    taskLimitPayButtonText: '',
    taskLimitPaying: false,
    taskLimitPayDisabled: false,
    taskLimitPayFeedback: '',
  },

  methods: {
    onSpotPopupClose() {
      this.setData({ showSpotPopup: false });
      this.triggerEvent('close');
    },

    onPopupSetReminder(e) {
      const d = e.detail || {};
      this.onSpotPopupClose();
      return reminderFlow.openDateSheet(this, {
        spotId: d.spotId,
        spotName: d.spotName,
        title: '设置提醒',
        remindOn: true,
        multiple: true,
      });
    },

    onPopupAddTripOnly(e) {
      const d = e.detail || {};
      this.onSpotPopupClose();
      return reminderFlow.openDateSheet(this, {
        spotId: d.spotId,
        spotName: d.spotName,
        title: '加入行程',
        remindOn: false,
        multiple: true,
      });
    },

    onDateConfirm(e) {
      return reminderFlow.onDateConfirm(this, e);
    },

    onDateClose() {
      return reminderFlow.onDateClose(this);
    },

    onReminderAuthPrimary() {
      return reminderFlow.requestReminderAuthOnce(this);
    },

    onReminderAuthSettings() {
      return reminderFlow.openReminderAuthSettings(this);
    },

    onReminderAuthTripOnly() {
      return reminderFlow.tripOnlyReminderCheckout(this);
    },

    onReminderAuthClose() {
      return reminderFlow.closeReminderCheckout(this);
    },

    onReminderAuthContinue() {
      return reminderFlow.continueReminderCheckout(this);
    },

    onReminderAuthReselect() {
      return reminderFlow.reselectReminderDates(this);
    },

    onReminderAuthPay() {
      return reminderFlow.openTaskLimitPayment(this);
    },

    onReminderAuthBenefits() {
      return reminderFlow.openTaskLimitBenefitsPage(this);
    },

    onReminderAuthPayClose() {
      return reminderFlow.closeTaskLimitPayment(this);
    },

    onReminderAuthPayConfirm() {
      return reminderFlow.confirmTaskLimitPayment(this);
    },
  },
});
