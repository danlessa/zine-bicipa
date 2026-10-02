Goal: have a pure HTML+JS static app that generates a two-sided A4 PDF for a zine. That zine is a checklist for birdwatching based on eBird hostspots.

Context: This zine will be printed and distributed by Bicipassarinhar (instagram: @bicipassarinhar), which is a collective blending birdwatching and bicycling around São Paulo. It is mantained by Anajú (https://anaju.xyz)

Input: eBird list URL (eg. https://ebird.org/hotspot/L19543097/bird-list)

Output: A two-page A4 PDF that allows someone to print, cut and fold it into a A7 zine. 
    - The zine front cover has a title "As aves da/de/do XXXX", where XXX is the place name indicated by the list. Choose da/de/do depending on the XXXX grammatical gender. Assume pt-BR as language. Also, it should be indicated the total amount of distinct species on that list.
    - The zine back cover contains a Bicipassarinhar logo and a phrase.
    - The front-facing pages of the zine should have a checklist for the most-recently observed species. Max of 84.
    - The back-facing pages should have photos for the most-recently observed species. Max of 84. It should indicate the photo author.
    - There's a template at examples/zine.pdf for reference. 