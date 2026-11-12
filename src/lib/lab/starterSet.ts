import type { Truth } from "./score";

/*
 * Songs to start a prompt-lab test set with, found by Spotify search rather
 * than by id so a regional or reissued copy still matches. Weighted toward
 * the neighbours the summary prompt has to tell apart (liquid vs neuro vs
 * jungle, dubstep vs garage, hardstyle vs hardcore, house vs techno), then
 * the same kind of close calls outside dance music: synthwave vs new wave,
 * heavy vs thrash vs sludge metal, punk vs hardcore punk, indie vs
 * alternative rock, R&B vs neo soul, and rap's regional and era styles.
 */

export interface StarterSong {
  artist: string;
  title: string;
  note: string;
  truth: Truth;
}

export const STARTER_SET: StarterSong[] = [
  {
    artist: "London Elektricity",
    title: "Just One Second",
    note: "Liquid DnB at 174: must not be called hardcore",
    truth: { required: ["liquid drum and bass | liquid funk"], acceptable: ["drum and bass", "soul"] },
  },
  {
    artist: "High Contrast",
    title: "If We Ever",
    note: "Liquid DnB with a vocal",
    truth: { required: ["liquid drum and bass | liquid funk"], acceptable: ["drum and bass", "vocal drum and bass"] },
  },
  {
    artist: "Netsky",
    title: "Memory Lane",
    note: "Melodic liquid DnB",
    truth: { required: ["liquid drum and bass | liquid funk"], acceptable: ["drum and bass"] },
  },
  {
    artist: "Noisia",
    title: "Diplodocus",
    note: "Neurofunk: same tempo as liquid, very different sound",
    truth: { required: ["neurofunk"], acceptable: ["drum and bass", "techstep"] },
  },
  {
    artist: "Goldie",
    title: "Inner City Life",
    note: "Early jungle / intelligent DnB",
    truth: { required: ["jungle | drum and bass"], acceptable: ["intelligent drum and bass", "atmospheric drum and bass"] },
  },
  {
    artist: "Skrillex",
    title: "Scary Monsters and Nice Sprites",
    note: "Brostep: half-time at 140",
    truth: { required: ["dubstep | brostep"], acceptable: ["electro house", "edm"] },
  },
  {
    artist: "Burial",
    title: "Archangel",
    note: "Future garage; often mis-tagged as plain dubstep",
    truth: { required: ["future garage | uk garage"], acceptable: ["dubstep", "ambient", "2-step"] },
  },
  {
    artist: "FISHER",
    title: "Losing It",
    note: "Tech house at ~125",
    truth: { required: ["tech house"], acceptable: ["house"] },
  },
  {
    artist: "Daft Punk",
    title: "One More Time",
    note: "French house",
    truth: { required: ["french house | filter house"], acceptable: ["house", "disco house", "nu-disco"] },
  },
  {
    artist: "Charlotte de Witte",
    title: "Doppler",
    note: "Peak-time techno",
    truth: { required: ["techno"], acceptable: ["peak time techno", "acid techno", "hard techno"] },
  },
  {
    artist: "Headhunterz",
    title: "Dragonborn",
    note: "Euphoric hardstyle at ~150",
    truth: { required: ["hardstyle"], acceptable: ["euphoric hardstyle"] },
  },
  {
    artist: "Angerfist",
    title: "Raise Your Fist",
    note: "Gabber / mainstream hardcore: fast and distorted",
    truth: { required: ["hardcore | gabber"], acceptable: ["mainstream hardcore", "hardcore techno"] },
  },
  {
    artist: "Aphex Twin",
    title: "Windowlicker",
    note: "IDM: resists a dance-floor label",
    truth: { required: ["idm | braindance"], acceptable: ["electronic", "drill and bass", "experimental"] },
  },
  {
    artist: "Bonobo",
    title: "Kerala",
    note: "Downtempo with a house pulse",
    truth: { required: ["downtempo"], acceptable: ["electronica", "chillout", "deep house", "trip hop"] },
  },
  {
    artist: "Tame Impala",
    title: "The Less I Know The Better",
    note: "Non-electronic: psych pop",
    truth: { required: ["psychedelic pop | neo-psychedelia"], acceptable: ["indie pop", "psychedelic rock", "disco"] },
  },
  {
    artist: "Kendrick Lamar",
    title: "HUMBLE.",
    note: "Non-electronic: hip hop",
    truth: { required: ["hip hop | rap"], acceptable: ["trap", "west coast hip hop", "conscious hip hop"] },
  },

  // ---- Synthwave: a 2010s revival of 80s sounds, not 80s music itself ----
  {
    artist: "Kavinsky",
    title: "Nightcall",
    note: "Outrun synthwave; also tied to French electro",
    truth: { required: ["synthwave | outrun"], acceptable: ["retrowave", "french house", "electro", "synth-pop"] },
  },
  {
    artist: "The Midnight",
    title: "Los Angeles",
    note: "Vocal synthwave with sax",
    truth: { required: ["synthwave | retrowave"], acceptable: ["synth-pop", "outrun"] },
  },
  {
    artist: "FM-84",
    title: "Running in the Night",
    note: "Synthwave that sounds like 80s pop: must not be called new wave",
    truth: { required: ["synthwave | retrowave"], acceptable: ["synth-pop", "outrun"] },
  },
  {
    artist: "Perturbator",
    title: "Future Club",
    note: "Darksynth: the heavy end of synthwave",
    truth: { required: ["darksynth | synthwave"], acceptable: ["retrowave", "outrun", "cyberpunk"] },
  },

  // ---- New wave and post-punk: the actual 80s ----
  {
    artist: "Talking Heads",
    title: "Once in a Lifetime",
    note: "New wave with funk and art-rock",
    truth: { required: ["new wave"], acceptable: ["post-punk", "art rock", "funk rock", "art pop"] },
  },
  {
    artist: "Depeche Mode",
    title: "Just Can't Get Enough",
    note: "Early synth-pop",
    truth: { required: ["synth-pop | new wave"], acceptable: ["dance-pop", "electropop"] },
  },
  {
    artist: "Blondie",
    title: "Heart of Glass",
    note: "New wave crossed with disco",
    truth: { required: ["new wave"], acceptable: ["disco", "pop rock", "dance-rock"] },
  },
  {
    artist: "The Cure",
    title: "Just Like Heaven",
    note: "New wave / jangle pop, not their gothic side",
    truth: { required: ["new wave | alternative rock"], acceptable: ["jangle pop", "post-punk", "dream pop"] },
  },
  {
    artist: "Joy Division",
    title: "Love Will Tear Us Apart",
    note: "Post-punk",
    truth: { required: ["post-punk"], acceptable: ["new wave", "gothic rock", "dark wave"] },
  },

  // ---- Rock ----
  {
    artist: "Led Zeppelin",
    title: "Whole Lotta Love",
    note: "Hard rock built on blues",
    truth: { required: ["hard rock | blues rock"], acceptable: ["classic rock", "rock", "heavy metal"] },
  },
  {
    artist: "Fleetwood Mac",
    title: "Go Your Own Way",
    note: "Soft rock / pop rock",
    truth: { required: ["soft rock | pop rock"], acceptable: ["classic rock", "rock"] },
  },
  {
    artist: "Nirvana",
    title: "Smells Like Teen Spirit",
    note: "Grunge",
    truth: { required: ["grunge"], acceptable: ["alternative rock", "punk rock"] },
  },
  {
    artist: "Foo Fighters",
    title: "Everlong",
    note: "Alternative rock / post-grunge",
    truth: { required: ["alternative rock | post-grunge"], acceptable: ["rock", "hard rock", "grunge"] },
  },
  {
    artist: "Queens of the Stone Age",
    title: "No One Knows",
    note: "Stoner rock",
    truth: { required: ["stoner rock | desert rock"], acceptable: ["alternative rock", "hard rock", "alternative metal"] },
  },

  // ---- Indie rock ----
  {
    artist: "The Strokes",
    title: "Last Nite",
    note: "Garage rock revival",
    truth: { required: ["garage rock revival | indie rock"], acceptable: ["garage rock", "post-punk revival", "alternative rock"] },
  },
  {
    artist: "Arctic Monkeys",
    title: "I Bet You Look Good on the Dancefloor",
    note: "UK indie rock",
    truth: { required: ["indie rock"], acceptable: ["garage rock revival", "post-punk revival", "alternative rock"] },
  },
  {
    artist: "Modest Mouse",
    title: "Float On",
    note: "US indie rock",
    truth: { required: ["indie rock"], acceptable: ["alternative rock", "indie pop"] },
  },
  {
    artist: "Pixies",
    title: "Where Is My Mind?",
    note: "Alternative rock that indie rock grew from",
    truth: { required: ["alternative rock | indie rock"], acceptable: ["noise pop", "college rock", "post-punk"] },
  },

  // ---- Heavy metal ----
  {
    artist: "Black Sabbath",
    title: "Paranoid",
    note: "Early heavy metal",
    truth: { required: ["heavy metal"], acceptable: ["hard rock", "doom metal", "proto-metal"] },
  },
  {
    artist: "Iron Maiden",
    title: "The Trooper",
    note: "New wave of British heavy metal",
    truth: { required: ["heavy metal | nwobhm"], acceptable: ["new wave of british heavy metal", "speed metal"] },
  },
  {
    artist: "Metallica",
    title: "Master of Puppets",
    note: "Thrash metal",
    truth: { required: ["thrash metal"], acceptable: ["heavy metal", "speed metal"] },
  },
  {
    artist: "Slayer",
    title: "Raining Blood",
    note: "Thrash at its fastest: must not be called death metal",
    truth: { required: ["thrash metal"], acceptable: ["speed metal", "heavy metal"] },
  },
  {
    artist: "Crowbar",
    title: "All I Had (I Gave)",
    note: "Sludge metal: slow, heavy, hardcore-rooted",
    truth: { required: ["sludge metal"], acceptable: ["doom metal", "heavy metal", "southern metal"] },
  },
  {
    artist: "Crowbar",
    title: "Planets Collide",
    note: "Sludge metal",
    truth: { required: ["sludge metal"], acceptable: ["doom metal", "heavy metal", "groove metal"] },
  },
  {
    artist: "Gojira",
    title: "Stranded",
    note: "Groove / progressive metal",
    truth: { required: ["groove metal | progressive metal"], acceptable: ["death metal", "technical death metal", "alternative metal"] },
  },

  // ---- Punk ----
  {
    artist: "Ramones",
    title: "Blitzkrieg Bop",
    note: "Early punk rock",
    truth: { required: ["punk rock | punk"], acceptable: ["proto-punk", "rock and roll"] },
  },
  {
    artist: "Sex Pistols",
    title: "Anarchy in the U.K.",
    note: "UK punk",
    truth: { required: ["punk rock | punk"], acceptable: ["uk punk"] },
  },
  {
    artist: "Dead Kennedys",
    title: "Holiday in Cambodia",
    note: "US hardcore punk",
    truth: { required: ["hardcore punk | punk rock"], acceptable: ["punk", "post-punk"] },
  },
  {
    artist: "Bad Brains",
    title: "Pay to Cum",
    note: "Hardcore punk at its fastest",
    truth: { required: ["hardcore punk"], acceptable: ["punk rock", "punk"] },
  },
  {
    artist: "Green Day",
    title: "Basket Case",
    note: "Pop punk",
    truth: { required: ["pop punk"], acceptable: ["punk rock", "alternative rock", "skate punk"] },
  },

  // ---- R&B ----
  {
    artist: "TLC",
    title: "No Scrubs",
    note: "90s R&B",
    truth: { required: ["r&b | contemporary r&b"], acceptable: ["hip hop soul", "pop"] },
  },
  {
    artist: "D'Angelo",
    title: "Untitled (How Does It Feel)",
    note: "Neo soul",
    truth: { required: ["neo soul"], acceptable: ["r&b", "soul", "funk"] },
  },
  {
    artist: "Frank Ocean",
    title: "Thinkin Bout You",
    note: "Alternative R&B",
    truth: { required: ["alternative r&b | r&b"], acceptable: ["neo soul", "soul", "pop"] },
  },
  {
    artist: "SZA",
    title: "Good Days",
    note: "Alternative R&B",
    truth: { required: ["alternative r&b | r&b"], acceptable: ["neo soul", "contemporary r&b", "psychedelic soul"] },
  },
  {
    artist: "Usher",
    title: "Yeah!",
    note: "Crunk&B: R&B over a crunk beat",
    truth: { required: ["r&b | crunk&b"], acceptable: ["crunk", "hip hop", "dance-pop"] },
  },

  // ---- Rap ----
  {
    artist: "Run-DMC",
    title: "It's Tricky",
    note: "Old-school hip hop",
    truth: { required: ["old school hip hop | hip hop"], acceptable: ["rap rock", "east coast hip hop"] },
  },
  {
    artist: "Nas",
    title: "N.Y. State of Mind",
    note: "East Coast hip hop",
    truth: { required: ["east coast hip hop | hip hop"], acceptable: ["boom bap", "hardcore hip hop", "rap"] },
  },
  {
    artist: "OutKast",
    title: "B.O.B.",
    note: "Southern hip hop with drum and bass in it",
    truth: { required: ["southern hip hop | hip hop"], acceptable: ["experimental hip hop", "rap rock", "psychedelic hip hop", "drum and bass"] },
  },
  {
    artist: "Travis Scott",
    title: "SICKO MODE",
    note: "Trap",
    truth: { required: ["trap | hip hop"], acceptable: ["rap", "southern hip hop"] },
  },
  {
    artist: "Death Grips",
    title: "Guillotine",
    note: "Experimental / industrial hip hop",
    truth: { required: ["experimental hip hop | industrial hip hop"], acceptable: ["hip hop", "noise", "hardcore hip hop"] },
  },

  // ---- A few more corners ----
  {
    artist: "Massive Attack",
    title: "Teardrop",
    note: "Trip hop",
    truth: { required: ["trip hop"], acceptable: ["downtempo", "electronica"] },
  },
  {
    artist: "My Bloody Valentine",
    title: "Only Shallow",
    note: "Shoegaze",
    truth: { required: ["shoegaze"], acceptable: ["dream pop", "noise pop", "alternative rock"] },
  },
  {
    artist: "Bon Iver",
    title: "Skinny Love",
    note: "Indie folk",
    truth: { required: ["indie folk"], acceptable: ["folk", "chamber folk", "singer-songwriter"] },
  },
  {
    artist: "Johnny Cash",
    title: "Ring of Fire",
    note: "Country",
    truth: { required: ["country"], acceptable: ["outlaw country", "rockabilly", "americana"] },
  },
  {
    artist: "Bob Marley & The Wailers",
    title: "Is This Love",
    note: "Roots reggae",
    truth: { required: ["reggae | roots reggae"], acceptable: [] },
  },
  {
    artist: "Miles Davis",
    title: "So What",
    note: "Modal jazz",
    truth: { required: ["modal jazz | jazz"], acceptable: ["cool jazz", "hard bop"] },
  },
  {
    artist: "Chic",
    title: "Le Freak",
    note: "Disco: the root of a lot of house",
    truth: { required: ["disco"], acceptable: ["funk", "post-disco", "r&b"] },
  },
];
