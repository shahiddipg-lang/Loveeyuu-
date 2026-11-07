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
  let accepting = false;
  let starting = false;

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
    const { data: { user }, error } =
      await db().auth.getUser();

    if (error) throw error;

    uid = user?.id || null;
    return uid;
  }

  async function refreshMatches() {
    const rows = await request(db().rpc('my_matches'));
    const select = $('rtcMatch');

    if (!select) return [];

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
      throw new Error(
        'Camera or microphone unavailable in this browser.'
      );
    }

    return navigator.mediaDevices.getUserMedia({
      audio: true,
      video: kind === 'video'
    });
  }

  function createPeer() {
    const connection = new RTCPeerConnection(rtcConfig);
    peer = connection;

    connection.ontrack = event => {
      const remote = $('rtcRemote');

      if (remote && event.streams[0]) {
        remote.srcObject = event.streams[0];
        remote.play().catch(() => {});
      }
    };

    connection.onconnectionstatechange = () => {
      if (peer !== connection) return;

      const state = connection.connectionState;

      console.log('loveeyuu WebRTC state:', state);

      if (state === 'connected') {
        status('Connected 💜');
        if (!timer) startTimer();
      } else if (state === 'connecting') {
        status('Connecting…');
      } else if (state === 'failed') {
        status(
          'Connection failed. A TURN server may be required.'
        );
      } else if (state === 'disconnected') {
        status('Connection interrupted.');
      }
    };

    connection.oniceconnectionstatechange = () => {
      console.log(
        'loveeyuu ICE state:',
        connection.iceConnectionState
      );
    };

    for (const track of stream.getTracks()) {
      connection.addTrack(track, stream);
    }

    return connection;
  }

  async function waitForICE(connection) {
    if (connection.iceGatheringState === 'complete') {
      return;
    }

    await new Promise(resolve => {
      const timeout = setTimeout(finish, 8000);

      function finish() {
        clearTimeout(timeout);
        connection.removeEventListener(
          'icegatheringstatechange',
          check
        );
        resolve();
      }

      function check() {
        if (connection.iceGatheringState === 'complete') {
          finish();
        }
      }

      connection.addEventListener(
        'icegatheringstatechange',
        check
      );

      check();
    });
  }

  function startTimer() {
    if (timer) return;

    startedAt = Date.now();

    timer = setInterval(() => {
      const seconds = Math.floor(
        (Date.now() - startedAt) / 1000
      );

      const mm = String(
        Math.floor(seconds / 60)
      ).padStart(2, '0');

      const ss = String(
        seconds % 60
      ).padStart(2, '0');

      $('rtcTimer').textContent = `${mm}:${ss}`;
    }, 1000);
  }

  async function cleanup() {
    clearInterval(timer);
    timer = null;
    startedAt = 0;

    const oldPeer = peer;
    peer = null;

    if (oldPeer) {
      oldPeer.ontrack = null;
      oldPeer.onconnectionstatechange = null;
      oldPeer.oniceconnectionstatechange = null;
      oldPeer.close();
    }

    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }

    $('rtcLocal').srcObject = null;
    $('rtcRemote').srcObject = null;
    $('rtcTimer').textContent = '00:00';

    currentCall = null;
    accepting = false;
    showCall(false);
  }

  async function markEnded(id, state = 'ended') {
    if (!id) return;

    await request(
      db().from('calls')
        .update({
          state,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
    );
  }

  async function endCall() {
    const id = currentCall?.id;

    await cleanup();

    try {
      await markEnded(id);
      status('Call ended.');
    } catch (error) {
      status('End call error: ' + error.message);
    }
  }

  async function startCall(kind) {
    if (currentCall || starting) return;

    starting = true;

    try {
      await identity();

      if (!uid) {
        throw new Error('Please log in first.');
      }

      const people = await refreshMatches();
      const callee = $('rtcMatch').value;

      if (!callee || !people.some(p => p.id === callee)) {
        status('Select a mutual match first.');
        return;
      }

      status('Requesting microphone permission…');

      stream = await getMedia(kind);
      $('rtcLocal').srcObject = stream;

      const connection = createPeer();

      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);

      status('Preparing connection…');
      await waitForICE(connection);

      currentCall = await request(
        db().from('calls')
          .insert({
            caller: uid,
            callee,
            kind,
            offer: connection.localDescription,
            state: 'ringing'
          })
          .select()
          .single()
      );

      showCall(true);
      status('Ringing…');

    } catch (error) {
      console.error('loveeyuu startCall failed:', error);

      const message = error?.message || String(error);

      await cleanup();
      status('Call error: ' + message);

    } finally {
      starting = false;
    }
  }

  async function acceptCall() {
    if (
      !currentCall ||
      currentCall.state !== 'ringing' ||
      accepting
    ) {
      return;
    }

    accepting = true;

    try {
      status('Requesting microphone permission…');

      stream = await getMedia(currentCall.kind);
      $('rtcLocal').srcObject = stream;

      const connection = createPeer();

      status('Reading incoming connection…');

      await connection.setRemoteDescription(
        currentCall.offer
      );

      const answer = await connection.createAnswer();

      await connection.setLocalDescription(answer);

      status('Preparing connection…');

      await waitForICE(connection);

      const updated = await request(
        db().from('calls')
          .update({
            answer: connection.localDescription,
            state: 'accepted',
            updated_at: new Date().toISOString()
          })
          .eq('id', currentCall.id)
          .eq('state', 'ringing')
          .select()
          .maybeSingle()
      );

      if (!updated) {
        throw new Error(
          'Call could not be accepted. It may have ended.'
        );
      }

      currentCall.state = 'accepted';

      showCall(true);
      status('Connecting…');

    } catch (error) {
      console.error('loveeyuu acceptCall failed:', error);

      const message = error?.message || String(error);

      // Preserve the real error instead of hiding it
      // behind "Call ended".
      await cleanup();

      status('Accept failed: ' + message);

    } finally {
      accepting = false;
    }
  }

  async function poll() {
    if (
      pollBusy ||
      !uid ||
      document.hidden ||
      accepting ||
      starting
    ) {
      return;
    }

    pollBusy = true;

    try {
      if (currentCall) {
        const callId = currentCall.id;

        const row = await request(
          db().from('calls')
            .select('*')
            .eq('id', callId)
            .maybeSingle()
        );

        // Ignore a stale poll result after cleanup.
        if (!currentCall || currentCall.id !== callId) {
          return;
        }

        if (
          !row ||
          ['ended', 'declined'].includes(row.state)
        ) {
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
          status('Connecting…');
        }

        currentCall.state = row.state;

      } else {
        const rows = await request(
          db().from('calls')
            .select('*')
            .eq('callee', uid)
            .eq('state', 'ringing')
            .order('created_at', {
              ascending: false
            })
            .limit(5)
        );

        const incoming = (rows || []).find(
          row =>
            Date.now() - Date.parse(row.created_at) < 60000
        );

        if (incoming && !currentCall) {
          currentCall = incoming;

          $('rtcIncoming').hidden = false;
          $('rtcStart').hidden = true;

          status(
            'Incoming ' + incoming.kind + ' call!'
          );
        }
      }

    } catch (error) {
      console.error('loveeyuu poll failed:', error);

      status(
        'Call error: ' +
        (error?.message || String(error))
      );

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
      window.loveeyuuCallTimer = setInterval(
        poll,
        1800
      );
    }

    status('Ready for test calls.');
  }

  function run(fn) {
    Promise.resolve()
      .then(fn)
      .catch(error => {
        console.error('loveeyuu call error:', error);

        status(
          'Call error: ' +
          (error?.message || String(error))
        );
      });
  }

  $('rtcRefresh').onclick = () => run(async () => {
    await identity();
    await refreshMatches();
    status('Matches refreshed.');
  });

  $('rtcVoice').onclick = () =>
    run(() => startCall('voice'));

  $('rtcVideo').onclick = () =>
    run(() => startCall('video'));

  $('rtcAccept').onclick = () =>
    run(acceptCall);

  $('rtcDecline').onclick = () =>
    run(endCall);

  $('rtcHangup').onclick = () =>
    run(endCall);

  window.addEventListener(
    'loveeyuu:ready',
    () => run(init)
  );

  setTimeout(() => {
    if (db()) run(init);
  }, 800);

  window.addEventListener(
    'loveeyuu:signedout',
    () => {
      uid = null;

      clearInterval(window.loveeyuuCallTimer);
      window.loveeyuuCallTimer = null;

      run(cleanup);
    }
  );
})();
