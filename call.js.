(()=>{
'use strict';

const $ = id => document.getElementById(id);
const db = () => window.loveeyuuClient;

let uid = null;
let peer = null;
let stream = null;
let call = null;
let timer = null;
let polling = false;
let busy = false;

const rtcConfig = {
  iceServers: [
    {urls:'stun:stun.l.google.com:19302'}
  ]
};

function status(message) {
  $('rtcStatus').textContent = message;
}

async function request(query) {
  const {data,error} = await query;
  if(error) throw error;
  return data;
}

async function identity() {
  const {data:{user}} = await db().auth.getUser();
  uid = user?.id || null;
  return uid;
}

async function matches() {
  const rows = await request(db().rpc('my_matches'));
  const select = $('rtcMatch');
  const selected = select.value;

  select.replaceChildren();

  for(const person of rows) {
    const option = document.createElement('option');
    option.value = person.id;
    option.textContent = person.display_name;
    select.append(option);
  }

  if(rows.some(p => p.id === selected)) {
    select.value = selected;
  }

  return rows;
}

function display(active) {
  $('rtcActive').hidden = !active;
  $('rtcStart').hidden = active;
  $('rtcIncoming').hidden = true;
}

async function getMedia(kind) {
  return navigator.mediaDevices.getUserMedia({
    audio:true,
    video:kind === 'video'
  });
}

function createPeer() {
  peer = new RTCPeerConnection(rtcConfig);

  peer.ontrack = event => {
    if(event.streams[0]) {
      $('rtcRemote').srcObject = event.streams[0];
    }
  };

  peer.onconnectionstatechange = () => {
    if(!peer) return;

    if(peer.connectionState === 'connected') {
      status('Connected 💜');
    }

    if(peer.connectionState === 'failed') {
      status('Connection failed. A TURN server may be needed.');
    }
  };

  for(const track of stream.getTracks()) {
    peer.addTrack(track,stream);
  }
}

async function gatherICE() {
  if(peer.iceGatheringState === 'complete') return;

  await new Promise((resolve,reject) => {
    const timeout = setTimeout(() => {
      peer.removeEventListener('icegatheringstatechange',check);
      reject(new Error('Network setup timed out'));
    },15000);

    function check() {
      if(peer.iceGatheringState === 'complete') {
        clearTimeout(timeout);
        peer.removeEventListener('icegatheringstatechange',check);
        resolve();
      }
    }

    peer.addEventListener('icegatheringstatechange',check);
    check();
  });
}

function startTimer() {
  clearInterval(timer);
  const started = Date.now();

  timer = setInterval(() => {
    const seconds = Math.floor((Date.now()-started)/1000);
    const mm = String(Math.floor(seconds/60)).padStart(2,'0');
    const ss = String(seconds%60).padStart(2,'0');

    $('rtcTimer').textContent = `${mm}:${ss}`;
  },1000);
}

async function cleanup() {
  clearInterval(timer);
  timer = null;

  if(peer) {
    peer.ontrack = null;
    peer.close();
    peer = null;
  }

  if(stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }

  $('rtcLocal').srcObject = null;
  $('rtcRemote').srcObject = null;
  $('rtcTimer').textContent = '00:00';

  call = null;
  display(false);
}

async function endCall() {
  const id = call?.id;

  await cleanup();

  if(id) {
    await request(
      db().from('calls')
        .update({
          state:'ended',
          updated_at:new Date().toISOString()
        })
        .eq('id',id)
    );
  }

  status('Call ended.');
}

async function startCall(kind) {
  if(call) return;

  try {
    await identity();

    const people = await matches();
    const callee = $('rtcMatch').value;

    if(!callee || !people.some(p => p.id === callee)) {
      status('Select a mutual match first.');
      return;
    }

    stream = await getMedia(kind);
    $('rtcLocal').srcObject = stream;

    createPeer();

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    status('Preparing connection…');
    await gatherICE();

    call = await request(
      db().from('calls')
        .insert({
          caller:uid,
          callee,
          kind,
          offer:peer.localDescription,
          state:'ringing'
        })
        .select()
        .single()
    );

    display(true);
    status('Ringing…');

  } catch(error) {
    await cleanup();
    status('Call error: '+error.message);
  }
}

async function acceptCall() {
  if(!call || call.state !== 'ringing') return;

  try {
    stream = await getMedia(call.kind);
    $('rtcLocal').srcObject = stream;

    createPeer();

    await peer.setRemoteDescription(call.offer);

    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);

    await gatherICE();

    await request(
      db().from('calls')
        .update({
          answer:peer.localDescription,
          state:'accepted',
          updated_at:new Date().toISOString()
        })
        .eq('id',call.id)
        .eq('state','ringing')
    );

    call.state = 'accepted';

    display(true);
    startTimer();
    status('Connecting…');

  } catch(error) {
    status('Call error: '+error.message);
    await endCall();
  }
}

async function poll() {
  if(polling || busy || !uid || document.hidden) return;

  polling = true;

  try {
    if(call) {
      const row = await request(
        db().from('calls')
          .select('*')
          .eq('id',call.id)
          .maybeSingle()
      );

      if(!row || ['ended','declined'].includes(row.state)) {
        await cleanup();
        status('Other person ended the call.');
        return;
      }

      if(
        row.state === 'accepted' &&
        call.caller === uid &&
        row.answer &&
        peer &&
        !peer.currentRemoteDescription
      ) {
        await peer.setRemoteDescription(row.answer);
        startTimer();
        status('Connecting…');
      }

      call.state = row.state;

    } else {
      const rows = await request(
        db().from('calls')
          .select('*')
          .eq('callee',uid)
          .eq('state','ringing')
          .order('created_at',{ascending:false})
          .limit(5)
      );

      const incoming = (rows||[]).find(
        row => Date.now()-Date.parse(row.created_at)<60000
      );

      if(incoming) {
        call = incoming;
        display(false);
        $('rtcIncoming').hidden = false;
        $('rtcStart').hidden = true;
        status('Incoming '+incoming.kind+' call!');
      }
    }

  } catch(error) {
    status('Call error: '+error.message);
  } finally {
    polling = false;
  }
}

function run(fn) {
  if(busy) return;

  busy = true;

  Promise.resolve()
    .then(fn)
    .catch(error => status('Call error: '+error.message))
    .finally(() => busy = false);
}

$('rtcRefresh').onclick = () => run(async()=>{
  await identity();
  await matches();
  status('Matches refreshed.');
});

$('rtcVoice').onclick = () => run(()=>startCall('voice'));
$('rtcVideo').onclick = () => run(()=>startCall('video'));
$('rtcAccept').onclick = () => run(acceptCall);
$('rtcDecline').onclick = () => run(endCall);
$('rtcHangup').onclick = () => run(endCall);

async function init() {
  if(!db()) return;

  await identity();
  if(!uid) return;

  await matches();

  if(!window.loveeyuuCallTimer) {
    window.loveeyuuCallTimer = setInterval(poll,1800);
  }

  status('Ready for test calls.');
}

window.addEventListener('loveeyuu:ready',()=>run(init));

setTimeout(()=>{
  if(db()) run(init);
},800);

window.addEventListener('loveeyuu:signedout',()=>{
  uid = null;
  clearInterval(window.loveeyuuCallTimer);
  window.loveeyuuCallTimer = null;
  run(cleanup);
});

})();
