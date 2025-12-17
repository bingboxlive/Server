const NAMES = [
    'bing bong', 'bong bing', 'ding dong', 'ping pong', 'sing song', 'wong tong',
    'bang bong', 'bung bong', 'bing bang', 'king kong', 'zing zong', 'bling bong',
    'king bong', 'bink bonk', 'blang blong', 'zong zing', 'bonkers bings',
    'bingle dangle', 'bongle bing', 'bingo bongo', 'pong ping', 'dong ding',
    'song sing', 'long strong', 'gong song', 'bongus', 'bingerton', 'bongeroni',
    'bingly', 'boing boing', 'boing bong', 'bing boing', 'bingle', 'bongo',
    'dingle dong', 'dongle ding', 'ringle rong', 'rongle ring', 'pinglet',
    'pongus', 'kling klong', 'klong kling', 'bingus', 'bungo', 'blingus',
    'blongo', 'zingle zongle', 'zongle zingle', 'binkus bonkus', 'bingus bongus',
    'bango bango', 'bango bingo', 'bigga bonga', 'bim bom', 'blim blom',
    'bring brong', 'bip bop', 'click clack', 'clink clonk', 'crink cronk',
    'dingo dongo', 'dink donk', 'fingle fangle', 'flim flam', 'fling flong',
    'gling glong', 'hingle hangle', 'jingle jangle', 'jing jong', 'kink konk',
    'ling long', 'ming mong', 'ning nong', 'pink ponk', 'pling plong',
    'prang prong', 'quing quong', 'ring rong', 'shing shong', 'sing songy',
    'sking skong', 'sling slong', 'sting stong', 'swing swong', 'thring throng',
    'ting tong', 'tring trong', 'ving vong', 'bimp bomp', 'wing wong',
    'wingle wangle', 'ying yong', 'zig zag', 'zing zang', 'zink zonk',
    'zip zap', 'zippity zong', 'zongle', 'zingle', 'binger bonger'
];

function getRandomName() {
    return NAMES[Math.floor(Math.random() * NAMES.length)];
}

module.exports = { getRandomName };
