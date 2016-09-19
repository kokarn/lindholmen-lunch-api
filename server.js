const request = require( 'request' );
const cheerio = require( 'cheerio' );
const express = require( 'express' );

const DEFAULT_PORT = 4321;

// Load every hour
const LOAD_DISHES_INTERVAL = 3600000;
const TYPE_IMAGE_URLS = {
    Fisk: 'http://i.imgur.com/V0hxUyR.png',
    Kyckling: 'http://i.imgur.com/spExnvs.png',
    Kött: 'http://i.imgur.com/f4qJ0xe.png',
    Pasta: 'http://i.imgur.com/3NuKHcx.png',
    Sallad: 'http://i.imgur.com/nLKqIPD.png',
    Vegetariskt: 'http://i.imgur.com/nLKqIPD.png',
    Övrigt: 'http://i.imgur.com/lKpL4gp.png',
};

const app = express();

let dishes = {};

const specialTrim = function specialTrim ( unTrimmedString ) {
    return unTrimmedString
        .replace( /\t/gim, ' ' )
        .trim()
        .replace( /\s+/gim, ' ' );
};

const parseRow = function parseRow ( $row ) {
    const matchString = '</strong>';
    const name = $row.find( '.dish-name' ).html();
    const title = name.match( /<strong>(.+?)<\/strong>/im );
    const descStart = name.indexOf( matchString ) + matchString.length;
    const description = specialTrim( name.substr( descStart ) );
    const outputData =  {
        description: description,
        price: $row.find( '.table-list__column--price' ).text(),
        title: specialTrim( title[ 1 ] ),
        type: $row.find( '.icon-dish' ).text(),
    };

    if ( outputData.title === 'Veckans sallad' ) {
        outputData.type = 'Sallad';
    }

    return outputData;
};

const loadDishes = function loadDishes () {
    request( 'http://www.lindholmen.se/en/restaurants/matminnen', ( error, response, body ) => {
        const $ = cheerio.load( body, {
            decodeEntities: false,
        } );

        const currentDishes = [];

        $( '.view-dagens-lunch .table-list__row' ).each( ( index, element ) => {
            currentDishes.push( parseRow( $( element ) ) );
        } );

        dishes = currentDishes;
    } );
};

app.get( '/', ( webRequest, response ) => {
    response.send( dishes );
} );

app.get( '/slack', ( webRequest, response ) => {
    const responseData = {
        attachments: [],
    };

    for ( let i = 0; i < dishes.length; i = i + 1 ) {
        responseData.attachments.push( {
            footer: dishes[ i ].type,
            footer_icon: TYPE_IMAGE_URLS[ dishes[ i ].type ], // eslint-disable-line camelcase
            text: dishes[ i ].description,
            title: dishes[ i ].title,
        } );
    }

    response.send( responseData );
} );

loadDishes();
setTimeout( loadDishes, LOAD_DISHES_INTERVAL );

app.listen( process.env.PORT || DEFAULT_PORT, () => {
    console.log( 'Service up and running on port', process.env.PORT || DEFAULT_PORT );
} );
