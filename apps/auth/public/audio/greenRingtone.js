window.alarmSound = new Howl({
  src: ['/audio/greenRingtone.webm', '/audio/greenRingtone.mp3'],
  autoplay: true,
  loop: false,
  volume: 0.5,
  html5: true,
  onend: function () {
    console.log('Sound alarm finished!');
  },
});
