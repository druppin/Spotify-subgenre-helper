import type { Truth } from "./score";

/*
 * Songs to start a prompt-lab test set with, found by Spotify search rather
 * than by id so a regional or reissued copy still matches. Weighted toward
 * the neighbours the summary prompt has to tell apart (liquid vs neuro vs
 * jungle, dubstep vs garage, hardstyle vs hardcore, house vs techno), with
 * a few non-electronic songs so a prompt that only knows dance music shows.
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
];
