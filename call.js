(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const db = () => window.loveeyuuClient;

  let uid = null;
  let peer = null;
  let stream = null;
  let currentCall = null;
  let pollBusy = false;
  let timer = null;
  let startedAt = 0;

  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  function status(message) {
    const element = $('rtcStatus');
    if (element) element.textContent = message;
  }

  async function request(query) {
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }

  async function identity() {
    const { data: { user }, error } = await db().auth.getUser();
    if (error) throw error;
    uid = user?.id || null;
    return uid;
  }

  async function refreshMatches() {
    const rows = await request(db().rpc('my_matches'));
    const select = $('rtcMatch');
    const previous = select.value;

    select.replaceChildren();

    for (const person of rows || []) {
      const option = document.createElement('option');
      option.value = person.id;
      option.textContent = person.display_name;
      select.append(option);
    }

    if ((rows || []).some(p => p.id === previous)) {
      select.value = previous;
    }

    return rows || [];
  }

  function showCall(active) {
    $('rtcActive').hidden = !active;
    $('rtcStart').hidden = active;
    $('rtcIncoming').hidden = true;
  }

  async function getMedia(kind) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera or microphone is unavailable in this browser.');
    }

    return navigator.mediaDevices.getUserMedia({
      audio: true,
      video: kind === 'video'
    });
  }

  function createPeer() {
    peer = new RTCPeerConnection(rtcConfig);

    peer.ontrack = event => {
      if (event.streams[0]) {
        $('rtcRemote').srcObject = event.streams[0];
      }
    };

    peer.onconnectionstatechange = () => {
      if (!peer) return;

      if (peer.connectionState === 'connected') {
        status('Connected 💜');
      } else if (peer.connectionState === 'failed') {
        status('Connection failed. A TURN server may be required.');
      } else if (peer.connectionState === 'disconnected') {
        status('Connection interrupted.');
      }
    };

    for (const track of stream.getTracks()) {
      peer.addTrack(track, stream);
    }
  }

  async function waitForICE() {
    if (peer.iceGatheringState === 'complete') return;

    await new Promise(resolve => {
      const connection = peer;
      const timeout = setTimeout(finish, 8000);

      function finish() {
        clearTimeout(timeout);
        connection.removeEventListener('icegatheringstatechange', check);
        resolve();
      }

      function check() {
        if (connection.iceGatheringState === 'complete') finish();
      }

      connection.addEventListener('icegatheringstatechange', check);
      check();
    });
  }

  function startTimer() {
    clearInterval(timer);
    startedAt = Date.now();

    timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
      const ss = String(seconds % 60).padStart(2, '0');
      $('rtcTimer').textContent = `${mm}:${ss}`;
    }, 1000);
  }

  async function cleanup() {
    clearInterval(timer);
    timer = null;

    if (peer) {
      peer.ontrack = null;
      peer.close();
      peer = null;
    }

    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }

    $('rtcLocal').srcObject = null;
    $('rtcRemote').srcObject = null;
    $('rtcTimer').textContent = '00:00';

    currentCall = null;
    showCall(false);
  }

  async function endCall() {
    const id = currentCall?.id;

    await cleanup();

    if (id) {
      await request(
        db().from('calls')
          .update({
            state: 'ended',
            updated_at: new Date().toISOString()
          })
          .eq('id', id)
      );
    }

    status('Call ended.');
  }

  async function startCall(kind) {
    if (currentCall) return;

    try {
      await identity();

      const people = await refreshMatches();
      const callee = $('rtcMatch').value;

      if (!callee || !people.some(p => p.id === callee)) {
        status('Select a mutual match first.');
        return;
      }

      status('Requesting microphone permission…');

      stream = await getMedia(kind);
      $('rtcLocal').srcObject = stream;

      createPeer();

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      status('Preparing connection…');
      await waitForICE();

      currentCall = await request(
        db().from('calls')
          .insert({
            caller: uid,
            callee,
            kind,
            offer: peer.localDescription,
            state: 'ringing'
          })
          .select()
          .single()
      );

      showCall(true);
      status('Ringing…');

    } catch (error) {
      await cleanup();
      status('Call error: ' + error.message);
    }
  }

  async function acceptCall() {
    if (!currentCall || currentCall.state !== 'ringing') return;

    try {
      status('Requesting microphone permission…');

      stream = await getMedia(currentCall.kind);
      $('rtcLocal').srcObject = stream;

      createPeer();

      await peer.setRemoteDescription(currentCall.offer);

      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);

      status('Preparing connection…');
      await waitForICE();

      await request(
        db().from('calls')
          .update({
            answer: peer.localDescription,
            state: 'accepted',
            updated_at: new Date().toISOString()
          })
          .eq('id', currentCall.id)
          .eq('state', 'ringing')
      );

      currentCall.state = 'accepted';

      showCall(true);
      startTimer();
      status('Connecting…');

    } catch (error) {
      status('Call error: ' + error.message);
      await endCall();
    }
  }

  async function poll() {
    if (pollBusy || !uid || document.hidden) return;
    pollBusy = true;

    try {
      if (currentCall) {
        const row = await request(
          db().from('calls')
            .select('*')
            .eq('id', currentCall.id)
            .maybeSingle()
        );

        if (!row || ['ended', 'declined'].includes(row.state)) {
          await cleanup();
          status('Call ended.');
          return;
        }

        if (
          row.state === 'accepted' &&
          row.caller === uid &&
          row.answer &&
          peer &&
          !peer.currentRemoteDescription
        ) {
          await peer.setRemoteDescription(row.answer);
          startTimer();
          status('Connecting…');
        }

        currentCall.state = row.state;

      } else {
        const rows = await request(
          db().from('calls')
            .select('*')
            .eq('callee', uid)
            .eq('state', 'ringing')
            .order('created_at', { ascending: false })
            .limit(5)
        );

        const incoming = (rows || []).find(
          row => Date.now() - Date.parse(row.created_at) < 60000
        );

        if (incoming) {
          currentCall = incoming;
          $('rtcIncoming').hidden = false;
          $('rtcStart').hidden = true;
          status('Incoming ' + incoming.kind + ' call!');
        }
      }
    } catch (error) {
      status('Call error: ' + error.message);
    } finally {
      pollBusy = false;
    }
  }

  async function init() {
    if (!db()) return;

    await identity();
    if (!uid) return;

    await refreshMatches();

    if (!window.loveeyuuCallTimer) {
      window.loveeyuuCallTimer = setInterval(poll, 1800);
    }

    status('Ready for test calls.');
  }

  function run(fn) {
    Promise.resolve()
      .then(fn)
      .catch(error => status('Call error: ' + error.message));
  }

  $('rtcRefresh').onclick = () => run(async () => {
    await identity();
    await refreshMatches();
    status('Matches refreshed.');
  });

  $('rtcVoice').onclick = () => run(() => startCall('voice'));
  $('rtcVideo').onclick = () => run(() => startCall('video'));
  $('rtcAccept').onclick = () => run(acceptCall);
  $('rtcDecline').onclick = () => run(endCall);
  $('rtcHangup').onclick = () => run(endCall);

  window.addEventListener('loveeyuu:ready', () => run(init));

  setTimeout(() => {
    if (db()) run(init);
  }, 800);

  window.addEventListener('loveeyuu:signedout', () => {
    uid = null;
    clearInterval(window.loveeyuuCallTimer);
    window.loveeyuuCallTimer = null;
    run(cleanup);
  });
})();
