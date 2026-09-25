Component({
  properties: {
    spot: { type: Object, value: null },
  },

  methods: {
    onTap() {
      const spot = this.data.spot;
      if (spot && spot.spotId) this.triggerEvent('spottap', { spotId: spot.spotId });
    },
  },
});
