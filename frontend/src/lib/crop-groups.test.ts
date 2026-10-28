import { describe, expect, it } from 'vitest'

import { classifyCrop, groupCrops } from '@/lib/crop-groups'

describe('groupCrops', () => {
  const wholeCrop = { code: 210, name: 'Vårbyg, helsæd' }
  const wheat = { code: 11, name: 'Vinterhvede' }
  const barley = { code: 1, name: 'Vårbyg' }
  const potatoes = { name: 'Kartofler' }

  it('groups the crops in the order of the groups, keeping their own order', () => {
    expect(
      groupCrops([wholeCrop, wheat, barley, potatoes]).map(
        ({ group, crops }) => [group.id, crops],
      ),
    ).toEqual([
      ['springCereal', [barley]],
      ['winterCereal', [wheat]],
      ['potato', [potatoes]],
      ['wholeCropSilage', [wholeCrop]],
    ])
  })

  it('lets the afgrødekode decide when the crop has one', () => {
    expect(groupCrops([wholeCrop])[0].group.id).toBe('wholeCropSilage')
    expect(groupCrops([{ name: wholeCrop.name }])[0].group.id).toBe(
      'springCereal',
    )
  })

  it('leaves out groups without a crop', () => {
    expect(groupCrops([])).toEqual([])
  })
})

describe('classifyCrop', () => {
  it('does not find a keyword inside another word', () => {
    expect(classifyCrop(531, 'Anden træfrugt')).toBe('other')
    expect(classifyCrop(484, 'Skovlandbrug med omdriftsafgrøder')).toBe('other')
    expect(classifyCrop(361, 'Ikke støtteberettiget landbrugsareal')).toBe(
      'other',
    )
    expect(classifyCrop(551, 'Moskusgræskar')).toBe('other')
  })

  it('finds a keyword at the start or the end of a word', () => {
    expect(classifyCrop(423, 'Sukkermajs')).toBe('maize')
    expect(classifyCrop(424, 'Ærter, konsum')).toBe('legume')
    expect(classifyCrop(596, 'Elefantgræs')).toBe('grass')
    expect(classifyCrop(124, 'Spinatfrø')).toBe('seedGrass')
    expect(classifyCrop(342, 'Bestøverbrak')).toBe('fallow')
  })

  it('puts fruit, forest and pumpkins under Andet before the other rules', () => {
    expect(classifyCrop(521, 'Surkirsebær med undervækst af græs')).toBe(
      'other',
    )
    expect(classifyCrop(522, 'Blomme uden undervækst af græs')).toBe('other')
    expect(classifyCrop(482, 'Skovlandbrug med permanent græs')).toBe('other')
  })

  it('does not read farming as rye', () => {
    expect(classifyCrop(582, 'Pyntegrønt, økologisk jordbrug')).toBe('other')
    expect(classifyCrop(907, 'Naturarealer, økologisk jordbrug')).toBe('fallow')
  })

  it('puts cereals and grønkorn harvested whole under Helsæd', () => {
    expect(classifyCrop(210, 'Vårbyg, helsæd')).toBe('wholeCropSilage')
    expect(classifyCrop(222, 'Vinterrug, helsæd')).toBe('wholeCropSilage')
    expect(classifyCrop(230, 'Blanding af vårkorn, grønkorn')).toBe(
      'wholeCropSilage',
    )
  })

  it('puts grønkorn of a single cereal under Helsæd whatever the species', () => {
    expect(classifyCrop(701, 'Grønkorn af vårbyg')).toBe('wholeCropSilage')
    expect(classifyCrop(709, 'Grønkorn af vinterrug')).toBe('wholeCropSilage')
    expect(classifyCrop(710, 'Grønkorn af hybridrug')).toBe('wholeCropSilage')
    expect(classifyCrop(711, 'Grønkorn af vintertriticale')).toBe(
      'wholeCropSilage',
    )
  })

  it('keeps majshelsæd under Majs', () => {
    expect(classifyCrop(216, 'Majshelsæd')).toBe('maize')
    expect(classifyCrop(218, 'Majshelsæd med græsudlæg')).toBe('maize')
  })

  it('takes fodder roots and nature grass out of Græs', () => {
    expect(classifyCrop(280, 'Fodersukkerroer')).toBe('beet')
    expect(classifyCrop(254, 'Miljøtilsagn, græs (0 N), permanent')).toBe(
      'fallow',
    )
    expect(classifyCrop(263, 'Græs uden kløvergræs (omdrift)')).toBe('grass')
  })

  it('puts every bræmme control code under Brak og natur', () => {
    expect(classifyCrop(988, 'Intern kode: Bræmme, permanent græs')).toBe(
      'fallow',
    )
    expect(classifyCrop(992, 'Intern kode: Bræmme, sommerslåning')).toBe(
      'fallow',
    )
  })
})
