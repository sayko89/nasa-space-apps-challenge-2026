README for Jezero crater mineral map
        Mario Parente, Yuki Itoh and Arun M. Saranathan




                                                          1
Scenes Processed
The images processed as part of this effort are:
1. HRL000040FF
2. FRT000047A3
3. FRT00005C5E
4. FRS00031442




                                                   2
UMass methods are described in:
• Y. Itoh, M. Parente (2021) A new method for atmospheric correction
  and de-noising of CRISM hyperspectral data, Icarus, Volume 354,
  2021, 114024, ISSN 0019-1035,
  https://doi.org/10.1016/j.icarus.2020.114024.2020.
• A.M. Saranathan, M. Parente (2021) Adversarial feature learning for
  improved mineral mapping of CRISM data, Icarus, Volume 355, 2021,
  114107, ISSN 0019-1035,
  https://doi.org/10.1016/j.icarus.2020.114107.



                                                                        3
Interpreting the Mineral Maps                           Very High Confidence
• Each color in the mineral map (here only                    detection
  showing HRL000040FF) corresponds to the
  detection of a specific spectral shape.
• The bold tones indicates that the pixel
  spectrum is identified as being like the
  prototype with very high confidence (the
  spectrum of the pixel will match the
  prototype)
• The subdued tones indicates that the pixel
  spectrum is identified as being like the
  prototype with high / intermediate               High/ Intermediate Confidenc
  confidence (the spectrum of the pixel will                  detection
  match the prototype with some minor
  variation)
• The specific RGB code assigned to a pixel can
  be used to identify both the mineral and the
  confidence level with which a pixel is
  identified
• A pixel with black color (RGB Code: 0, 0, 0)
  indicates the it was not identified as any of   In ENVI the maps are best
  the known prototypes.                           Viewed       with       ‘No
                                                  stretch’(ENVI 5) or ‘Linear
                                                  [0-255]’ (ENVI Classic)
                                                                       4
     Key for Mineral Detections
  Mineral Name       Base Color      RGB Code           RGB Code        N.B. -- The mineral names
                                  High Confidence   Medium Confidence   assigned to the various classes
                                                                        are based on closest match of the
     Olivine            Red          255, 0, 0          153, 0, 0
                                                                        prototypes to known mineral
  Mg-Carbonate         Green         0, 255, 0          0, 153, 0       identifications,          historical
 Fe/Mg-Smectite        Cyan         0, 255, 255        0, 153, 153      identification in prior publications
                                                                        or internal discussions among the
Olivine+ Smectite     Salmon       255, 128, 114       153, 77, 68      Fandango group. Exact mineral
Olv. Smect + 2.2µm     Olive        128, 128, 0         77, 77, 0       attributions can only be verified
  Carb. + 2.2µm        Gold         255, 215, 0        153, 129, 0      after further analysis using
                                                                        techniques such as Spectral
High Ca. Pyroxene     Orange        255, 128, 0         153, 77, 0      Unmixing, etc..
Low Ca. Pyroxene     Golden Rod    218, 165, 32        130, 99, 19

    Kaolinite          Brown        139, 69, 19         83, 41, 11

  Mg-Smectite 2         Blue         0, 0, 255          0, 0, 153                                   5
