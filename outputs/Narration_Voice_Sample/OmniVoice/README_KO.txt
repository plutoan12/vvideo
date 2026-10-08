OmniVoice 한국어 나레이션 비교

기존 Qwen3-TTS 음성을 변조한 파일이 아니라, 다른 TTS 모델 OmniVoice로 새로 생성한 합성음성입니다.
모델: mlx-community/OmniVoice-bf16
실행: MLX-Audio 0.5.8 / Apple M3 Max
두 파일: 남성 저음 지시 / 여성 중간 음높이 지시
9.52초, 24kHz, 모노 PCM WAV. 64단계 생성. 후처리는 비교용 음량 정규화뿐이며 속도·피치 조절은 하지 않았습니다.
실존 인물의 참고 녹음을 사용하지 않았습니다.

검증: 유한한 오디오 샘플, 무음이 아닌 출력, FFmpeg 전체 디코딩 성공.
검증 범위는 파일의 기술적 정상 여부이며, 발음·내용 일치·자연스러움을 청취로 보증한 것은 아닙니다.

소스: https://github.com/k2-fsa/OmniVoice
모델: https://huggingface.co/mlx-community/OmniVoice-bf16
재현 스크립트: work/omnivoice-narration/generate.py (작업 폴더 기준)

개발 문서에 따르면 이 모델은 참고 음성 복제 모드가 가장 안정적입니다.
본인 또는 사용을 허락받은 화자의 잡음 없는 한국어 3~10초 녹음과 대본을 제공하면 해당 모드로 추가 비교할 수 있습니다.
VoiceDesign은 한국어에서 품질 편차가 있을 수 있으므로 지금 파일은 후보 샘플입니다.
기존 60초 영상에는 아직 적용하지 않았습니다.
