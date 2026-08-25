Component({
  properties: {
    active: { type: String, value: 'home' },
  },

  methods: {
    onTap(e) {
      const tab = e.currentTarget.dataset.tab;
      if (tab === this.data.active) return;
      if (tab === 'home') {
        wx.redirectTo({ url: '/pages/home/home' });
      } else if (tab === 'profile') {
        wx.redirectTo({ url: '/pages/profile/profile' });
      }
    },
  },
});
